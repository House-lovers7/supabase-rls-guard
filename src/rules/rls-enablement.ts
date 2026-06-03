import { exposedTables } from '../core/schema-state.js'
import type { Finding, Rule } from '../core/types.js'
import { finding, isAllowlisted, SUPABASE_RLS_DOCS, splinterDocs } from './util.js'

/** RLS001 — a table in an API-exposed schema has no RLS enabled. */
export const rlsDisabledInPublic: Rule = {
  id: 'RLS001',
  name: 'rls_disabled_in_public',
  defaultSeverity: 'critical',
  splinter: '0013',
  description: 'Tables in an API-exposed schema must have Row Level Security enabled.',
  docs: splinterDocs('0013_rls_disabled_in_public'),
  evaluate({ state, config }) {
    return exposedTables(state)
      .filter((t) => !t.rlsEnabled && !isAllowlisted(config, t.schema, t.name))
      .map((t) =>
        finding({
          ruleId: 'RLS001',
          ruleName: 'rls_disabled_in_public',
          severity: 'critical',
          target: `${t.schema}.${t.name}`,
          message: `Table ${t.schema}.${t.name} is in an API-exposed schema but RLS is not enabled — anyone with the anon/publishable key can read and write it.`,
          fix: `ALTER TABLE ${t.schema}.${t.name} ENABLE ROW LEVEL SECURITY;`,
          docs: splinterDocs('0013_rls_disabled_in_public'),
          loc: t.definedAt,
        }),
      )
  },
}

/** RLS002 — RLS is enabled but there are no policies, so the table is fully locked. */
export const rlsEnabledNoPolicy: Rule = {
  id: 'RLS002',
  name: 'rls_enabled_no_policy',
  defaultSeverity: 'warning',
  splinter: '0008',
  description: 'RLS is enabled but no policy exists; the table returns no rows over the API.',
  docs: splinterDocs('0008_rls_enabled_no_policy'),
  evaluate({ state, config }) {
    return exposedTables(state)
      .filter(
        (t) => t.rlsEnabled && t.policies.length === 0 && !isAllowlisted(config, t.schema, t.name),
      )
      .map((t) =>
        finding({
          ruleId: 'RLS002',
          ruleName: 'rls_enabled_no_policy',
          severity: 'warning',
          target: `${t.schema}.${t.name}`,
          message: `Table ${t.schema}.${t.name} has RLS enabled but no policies — every API request returns zero rows. Did you forget to add a policy?`,
          fix: `CREATE POLICY "select_own" ON ${t.schema}.${t.name} FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);`,
          docs: splinterDocs('0008_rls_enabled_no_policy'),
          loc: t.definedAt,
        }),
      )
  },
}

/** RLS003 — a policy exists on a table whose RLS was never enabled, so the policy is inert. */
export const policyExistsRlsDisabled: Rule = {
  id: 'RLS003',
  name: 'policy_exists_rls_disabled',
  defaultSeverity: 'critical',
  splinter: '0007',
  description:
    'A policy exists but RLS is disabled on the table, giving a false sense of security.',
  docs: splinterDocs('0007_policy_exists_rls_disabled'),
  evaluate({ state }) {
    const findings: Finding[] = []
    for (const t of state.tables.values()) {
      if (!t.created || t.dropped || t.rlsEnabled || t.policies.length === 0) continue
      findings.push(
        finding({
          ruleId: 'RLS003',
          ruleName: 'policy_exists_rls_disabled',
          severity: 'critical',
          target: `${t.schema}.${t.name}`,
          message: `Table ${t.schema}.${t.name} has ${t.policies.length} policy(ies) but RLS is disabled, so the policies do nothing and the table is fully exposed.`,
          fix: `ALTER TABLE ${t.schema}.${t.name} ENABLE ROW LEVEL SECURITY;`,
          docs: splinterDocs('0007_policy_exists_rls_disabled'),
          loc: t.policies[0]?.loc ?? t.definedAt,
        }),
      )
    }
    return findings
  },
}

/** RLS018 — a migration explicitly disables RLS on a table. */
export const disableRlsInMigration: Rule = {
  id: 'RLS018',
  name: 'disable_rls_in_migration',
  defaultSeverity: 'warning',
  description: 'A migration runs ALTER TABLE ... DISABLE ROW LEVEL SECURITY.',
  docs: SUPABASE_RLS_DOCS,
  evaluate({ state }) {
    return state.rlsDisabledEvents.map((e) =>
      finding({
        ruleId: 'RLS018',
        ruleName: 'disable_rls_in_migration',
        severity: 'warning',
        target: `${e.schema}.${e.name}`,
        message: `A migration disables RLS on ${e.schema}.${e.name}. Make sure this is intentional — it removes the protection for this table.`,
        fix: `-- Remove the DISABLE, or re-enable: ALTER TABLE ${e.schema}.${e.name} ENABLE ROW LEVEL SECURITY;`,
        docs: SUPABASE_RLS_DOCS,
        loc: e.loc,
      }),
    )
  },
}
