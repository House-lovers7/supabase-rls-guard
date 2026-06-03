import { type ConfigOverrides, loadConfig } from '../config/load.js'
import { type FileSuppressions, isSuppressed, parseSuppressions } from '../config/suppressions.js'
import { type BackendChoice, parseSql } from '../parser/index.js'
import { evaluateRules } from '../rules/registry.js'
import { discover } from './discover.js'
import { foldStatements } from './schema-state.js'
import {
  type Finding,
  type ResolvedConfig,
  type ScanResult,
  type ScanSummary,
  SEVERITY_ORDER,
  type Statement,
} from './types.js'

export interface ScanOptions extends ConfigOverrides {
  /** File, migrations directory, or project root to scan. */
  path: string
  /** Parser backend selection (default `auto`). */
  backend?: BackendChoice
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.loc.file !== b.loc.file) return a.loc.file.localeCompare(b.loc.file)
  if (a.loc.line !== b.loc.line) return a.loc.line - b.loc.line
  const sev = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  if (sev !== 0) return sev
  return a.ruleId.localeCompare(b.ruleId)
}

function summarize(findings: Finding[], filesScanned: number, config: ResolvedConfig): ScanSummary {
  const summary: ScanSummary = {
    critical: 0,
    warning: 0,
    info: 0,
    total: findings.length,
    filesScanned,
    failed: false,
  }
  const threshold = SEVERITY_ORDER[config.failOn]
  for (const f of findings) {
    summary[f.severity]++
    if (SEVERITY_ORDER[f.severity] >= threshold) summary.failed = true
  }
  return summary
}

/**
 * Scan migrations and return findings.
 *
 * Pipeline: discover & order files -> parse each to statements -> fold all
 * statements (in application order) into one final {@link SchemaState} -> run
 * rules against that final state -> drop suppressed findings -> summarize.
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const config = await loadConfig(options)
  const files = await discover(options.path)

  const allStatements: Statement[] = []
  const suppressions = new Map<string, FileSuppressions>()
  const warnings: string[] = [...config.warnings]

  // Parse sequentially: the libpg-query WASM instance is shared and not
  // re-entrant, and we must keep statements in file (application) order anyway.
  for (const file of files) {
    const parsed = await parseSql(file.content, file.rel, options.backend)
    allStatements.push(...parsed.statements)
    suppressions.set(file.rel, parseSuppressions(file.content))
    for (const err of parsed.errors) warnings.push(`${err.file}: ${err.message}`)
  }

  const state = foldStatements(allStatements, config.exposedSchemas)

  const findings = evaluateRules({ state, config, statements: allStatements })
    .filter((f) => {
      const sup = suppressions.get(f.loc.file)
      return !(sup && isSuppressed(sup, f.ruleId, f.loc.line))
    })
    .sort(compareFindings)

  return { findings, summary: summarize(findings, files.length, config), config, warnings }
}
