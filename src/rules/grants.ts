import { exposedTables } from '../core/schema-state.js'
import type { Finding, Rule } from '../core/types.js'
import { finding, isAllowlisted, SUPABASE_RLS_DOCS } from './util.js'

const WRITE_OR_READ = ['select', 'insert', 'update', 'delete']

function grantsAccessToAnon(privileges: string[] | 'all', grantees: string[]): boolean {
  if (!grantees.some((g) => g === 'anon')) return false
  if (privileges === 'all') return true
  return privileges.some((p) => WRITE_OR_READ.includes(p.toLowerCase()))
}

/**
 * RLS005 — an explicit `GRANT ... TO anon` on a table that has no RLS. With RLS
 * off, the grant hands unauthenticated users direct table access.
 */
export const broadGrantToAnon: Rule = {
  id: 'RLS005',
  name: 'broad_grant_to_anon',
  defaultSeverity: 'critical',
  description: 'Privileges are granted to the anon role on a table without RLS.',
  docs: SUPABASE_RLS_DOCS,
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const t of exposedTables(state)) {
      if (t.rlsEnabled || isAllowlisted(config, t.schema, t.name)) continue
      const grant = t.grants.find((g) => grantsAccessToAnon(g.privileges, g.grantees))
      if (!grant) continue
      findings.push(
        finding({
          ruleId: 'RLS005',
          ruleName: 'broad_grant_to_anon',
          severity: 'critical',
          target: `${t.schema}.${t.name}`,
          message: `Privileges are granted to "anon" on ${t.schema}.${t.name}, which has no RLS — unauthenticated users get direct access.`,
          fix: `ALTER TABLE ${t.schema}.${t.name} ENABLE ROW LEVEL SECURITY; -- and scope grants/policies appropriately`,
          docs: SUPABASE_RLS_DOCS,
          loc: grant.loc,
        }),
      )
    }
    return findings
  },
}
