import { type ConfigOverrides, loadConfig } from '../config/load.js'
import { type FileSuppressions, isSuppressed, parseSuppressions } from '../config/suppressions.js'
import { detectDynamicRlsDdl } from '../parser/dynamic-ddl.js'
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
  // Plain codepoint comparison — deterministic across machines/locales.
  if (a.loc.file !== b.loc.file) return a.loc.file < b.loc.file ? -1 : 1
  if (a.loc.line !== b.loc.line) return a.loc.line - b.loc.line
  const sev = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  if (sev !== 0) return sev
  return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0
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

/** Rules that only make sense if the schema is actually served over PostgREST. */
const EXPOSURE_DEPENDENT_RULES = new Set(['RLS001', 'RLS004', 'RLS005'])

/**
 * Every "this table is reachable with the anon key" finding rests on one
 * premise: that `exposedSchemas` is what the API serves. Projects that use
 * Supabase only for auth and keep data elsewhere, or that front the database
 * with their own API, break that premise — and in the 2026-07-26 sweep they
 * accounted for 33 of the 73 false criticals. The escape hatch already existed;
 * what was missing was any sign of it at the point the criticals are read.
 */
function exposurePremiseHint(findings: Finding[], config: ResolvedConfig): string[] {
  if (!findings.some((f) => EXPOSURE_DEPENDENT_RULES.has(f.ruleId))) return []
  const schemas = config.exposedSchemas.map((s) => `"${s}"`).join(', ')
  return [
    `RLS001/RLS004/RLS005 assume PostgREST serves ${schemas || 'no schemas'}. If this database is not exposed that way — Supabase Auth with the data in another database, or access only through your own API — set "exposedSchemas" in your config to match and rescan.`,
  ]
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
  const { files, warnings: discoverWarnings } = await discover(options.path)

  const allStatements: Statement[] = []
  const suppressions = new Map<string, FileSuppressions>()
  const warnings: string[] = [...config.warnings, ...discoverWarnings]

  // Parse sequentially: the libpg-query WASM instance is shared and not
  // re-entrant, and we must keep statements in file (application) order anyway.
  for (const file of files) {
    const parsed = await parseSql(file.content, file.rel, options.backend)
    allStatements.push(...parsed.statements)
    suppressions.set(file.rel, parseSuppressions(file.content))
    for (const err of parsed.errors) warnings.push(`${err.file}: ${err.message}`)
    // Runs on the raw text, so both backends report the same blind spot.
    warnings.push(...detectDynamicRlsDdl(file.content, file.rel))
  }

  const state = foldStatements(allStatements, config.exposedSchemas)

  const findings = evaluateRules({ state, config, statements: allStatements })
    .filter((f) => {
      const sup = suppressions.get(f.loc.file)
      return !(sup && isSuppressed(sup, f.ruleId, f.loc.line))
    })
    .sort(compareFindings)

  return {
    findings,
    summary: summarize(findings, files.length, config),
    config,
    warnings,
    hints: exposurePremiseHint(findings, config),
  }
}
