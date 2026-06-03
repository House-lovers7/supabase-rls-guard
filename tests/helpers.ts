import { baseConfig } from '../src/config/defaults.js'
import { foldStatements } from '../src/core/schema-state.js'
import type { Finding, ResolvedConfig } from '../src/core/types.js'
import { type BackendChoice, parseSql } from '../src/parser/index.js'
import { evaluateRules } from '../src/rules/registry.js'

/** Parse a SQL string, fold it, and run all rules with the default config. */
export async function analyze(
  sql: string,
  options: { config?: Partial<ResolvedConfig>; backend?: BackendChoice } = {},
): Promise<Finding[]> {
  const { statements } = await parseSql(sql, 'test.sql', options.backend ?? 'auto')
  const config: ResolvedConfig = { ...baseConfig(), ...options.config }
  const state = foldStatements(statements, config.exposedSchemas)
  return evaluateRules({ state, config, statements })
}

export function ruleIds(findings: Finding[]): string[] {
  return findings.map((f) => f.ruleId)
}

export function hasRule(findings: Finding[], id: string): boolean {
  return findings.some((f) => f.ruleId === id)
}
