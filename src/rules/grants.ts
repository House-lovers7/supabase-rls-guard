import { exposedTables } from '../core/schema-state.js'
import type { Finding, Rule } from '../core/types.js'
import { finding, isAllowlisted, SUPABASE_RLS_DOCS } from './util.js'

const WRITE_OR_READ = ['select', 'insert', 'update', 'delete']

/** In Postgres, `TO PUBLIC` grants to every role — including anon. */
function isAnonGrantee(role: string): boolean {
  const r = role.toLowerCase()
  return r === 'anon' || r === 'public'
}

function grantsAccessToAnon(privileges: string[] | 'all', grantees: string[]): boolean {
  if (!grantees.some(isAnonGrantee)) return false
  if (privileges === 'all') return true
  return privileges.some((p) => WRITE_OR_READ.includes(p.toLowerCase()))
}

/**
 * RLS005 — privileges reach the anon role (directly, via PUBLIC, via a
 * schema-wide grant, or via default privileges) on a table that has no RLS.
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
      const via =
        grant.via === 'schemaGrant'
          ? ' (via GRANT … ON ALL TABLES IN SCHEMA)'
          : grant.via === 'defaultPrivileges'
            ? ' (via ALTER DEFAULT PRIVILEGES)'
            : grant.grantees.some((g) => g.toLowerCase() === 'public')
              ? ' (via GRANT … TO PUBLIC, which includes anon)'
              : ''
      findings.push(
        finding({
          ruleId: 'RLS005',
          ruleName: 'broad_grant_to_anon',
          severity: 'critical',
          target: `${t.schema}.${t.name}`,
          message: `Privileges are granted to "anon" on ${t.schema}.${t.name}${via}, which has no RLS — unauthenticated users get direct access.`,
          fix: `ALTER TABLE ${t.schema}.${t.name} ENABLE ROW LEVEL SECURITY; -- and scope grants/policies appropriately`,
          docs: SUPABASE_RLS_DOCS,
          loc: grant.loc,
        }),
      )
    }
    return findings
  },
}
