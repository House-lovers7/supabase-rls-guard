import { severityForColumn } from '../config/defaults.js'
import { exposedTables } from '../core/schema-state.js'
import type { Finding, Rule } from '../core/types.js'
import { finding, isAllowlisted, splinterDocs } from './util.js'

/**
 * RLS004 — a table with a sensitive-looking column (password, token, ssn, …) is
 * exposed without RLS. Only fires on unprotected tables, so properly-secured
 * tables never trip it.
 */
export const sensitiveColumnUnprotected: Rule = {
  id: 'RLS004',
  name: 'sensitive_column_unprotected',
  defaultSeverity: 'warning',
  splinter: '0023',
  description: 'A sensitive-looking column lives on a table that lacks RLS.',
  docs: splinterDocs('0023_sensitive_columns_exposed'),
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const t of exposedTables(state)) {
      if (t.rlsEnabled || isAllowlisted(config, t.schema, t.name)) continue
      for (const col of t.columns) {
        const severity = severityForColumn(col.name, config.sensitiveColumns)
        if (!severity) continue
        findings.push(
          finding({
            ruleId: 'RLS004',
            ruleName: 'sensitive_column_unprotected',
            severity,
            target: `${t.schema}.${t.name}.${col.name}`,
            message: `Column ${t.schema}.${t.name}.${col.name} looks sensitive and the table has no RLS — this data is exposed over the API.`,
            fix: `ALTER TABLE ${t.schema}.${t.name} ENABLE ROW LEVEL SECURITY; -- then add policies`,
            docs: splinterDocs('0023_sensitive_columns_exposed'),
            loc: t.definedAt,
          }),
        )
      }
    }
    return findings
  },
}
