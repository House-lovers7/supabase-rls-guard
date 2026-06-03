import type { Finding, PolicyInfo, Rule, SchemaState } from '../core/types.js'
import { finding, isAllowlisted, SUPABASE_RLS_DOCS, splinterDocs } from './util.js'

function* livePolicies(state: SchemaState): Generator<PolicyInfo> {
  for (const t of state.tables.values()) {
    if (t.dropped) continue
    yield* t.policies
  }
}

function appliesToUntrusted(roles: string[]): boolean {
  return roles.includes('anon') || roles.includes('public')
}

/** RLS006 — a permissive policy whose predicate is always true (`USING (true)`). */
export const policyUsingTrue: Rule = {
  id: 'RLS006',
  name: 'rls_policy_always_true',
  defaultSeverity: 'critical',
  splinter: '0024',
  description: 'A permissive policy uses an always-true predicate, bypassing RLS.',
  docs: splinterDocs('0024_permissive_rls_policy'),
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const p of livePolicies(state)) {
      if (!p.permissive) continue
      // USING (true) exposes existing rows on read/affect commands; INSERT has no USING.
      const dangerousUsing = p.usingAlwaysTrue && p.command !== 'insert'
      // WITH CHECK (true) on INSERT is the standard "anyone can submit" pattern
      // (e.g. a public contact form) and is intentionally NOT flagged here; on
      // UPDATE/ALL it lets a user rewrite rows to arbitrary values.
      const dangerousCheck = p.checkAlwaysTrue && (p.command === 'update' || p.command === 'all')
      if (!dangerousUsing && !dangerousCheck) continue
      if (isAllowlisted(config, p.schema, p.table)) continue
      const untrusted = appliesToUntrusted(p.roles)
      const clause = dangerousUsing ? 'USING (true)' : 'WITH CHECK (true)'
      findings.push(
        finding({
          ruleId: 'RLS006',
          ruleName: 'rls_policy_always_true',
          severity: untrusted ? 'critical' : 'warning',
          target: `${p.schema}.${p.table}`,
          message: `Policy "${p.name}" on ${p.schema}.${p.table} is permissive with ${clause}${untrusted ? ' for anon/public' : ''} — it grants unrestricted access and defeats RLS.`,
          fix: 'Replace the always-true predicate with a real condition, e.g. USING ((select auth.uid()) = user_id).',
          docs: splinterDocs('0024_permissive_rls_policy'),
          loc: p.loc,
        }),
      )
    }
    return findings
  },
}

/** RLS007 — a policy with no `TO` clause (or `TO public`) applies to every role. */
export const policyMissingRole: Rule = {
  id: 'RLS007',
  name: 'policy_missing_to_role',
  defaultSeverity: 'warning',
  description: 'A policy does not target a specific role and runs for all roles, including anon.',
  docs: SUPABASE_RLS_DOCS,
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const p of livePolicies(state)) {
      if (!p.roles.includes('public')) continue
      if (isAllowlisted(config, p.schema, p.table)) continue
      findings.push(
        finding({
          ruleId: 'RLS007',
          ruleName: 'policy_missing_to_role',
          severity: 'warning',
          target: `${p.schema}.${p.table}`,
          message: `Policy "${p.name}" on ${p.schema}.${p.table} has no TO clause, so it applies to every role (including anon) and is evaluated on every request.`,
          fix: 'Add a role, e.g. CREATE POLICY ... TO authenticated USING (...).',
          docs: SUPABASE_RLS_DOCS,
          loc: p.loc,
        }),
      )
    }
    return findings
  },
}

/** RLS008 — `auth.uid()` / `auth.jwt()` used un-wrapped, re-evaluated per row. */
export const authUidNotWrapped: Rule = {
  id: 'RLS008',
  name: 'auth_rls_initplan',
  defaultSeverity: 'warning',
  splinter: '0003',
  description: 'auth.* functions in a policy should be wrapped in a subquery for performance.',
  docs: splinterDocs('0003_auth_rls_initplan'),
  evaluate({ state }) {
    const findings: Finding[] = []
    for (const p of livePolicies(state)) {
      const unwrapped = [...new Set(p.authFns.filter((f) => !f.wrapped).map((f) => f.name))]
      if (unwrapped.length === 0) continue
      const fns = unwrapped.map((n) => `${n}()`).join(', ')
      findings.push(
        finding({
          ruleId: 'RLS008',
          ruleName: 'auth_rls_initplan',
          severity: 'warning',
          target: `${p.schema}.${p.table}`,
          message: `Policy "${p.name}" on ${p.schema}.${p.table} calls ${fns} directly; Postgres re-evaluates it for every row.`,
          fix: `Wrap the call in a subquery: (select ${unwrapped[0]}()) instead of ${unwrapped[0]}().`,
          docs: splinterDocs('0003_auth_rls_initplan'),
          loc: p.loc,
        }),
      )
    }
    return findings
  },
}

/** RLS009 — a policy trusts `user_metadata`, which the end user can edit. */
export const policyReferencesUserMetadata: Rule = {
  id: 'RLS009',
  name: 'rls_references_user_metadata',
  defaultSeverity: 'critical',
  splinter: '0015',
  description: 'A policy references user_metadata, which is user-editable and spoofable.',
  docs: splinterDocs('0015_rls_references_user_metadata'),
  evaluate({ state }) {
    const findings: Finding[] = []
    for (const p of livePolicies(state)) {
      if (!p.referencesUserMetadata) continue
      findings.push(
        finding({
          ruleId: 'RLS009',
          ruleName: 'rls_references_user_metadata',
          severity: 'critical',
          target: `${p.schema}.${p.table}`,
          message: `Policy "${p.name}" on ${p.schema}.${p.table} references user_metadata, which users can change via updateUser() — this is trivially bypassable privilege escalation.`,
          fix: 'Use app_metadata or a dedicated roles table instead of user_metadata / raw_user_meta_data.',
          docs: splinterDocs('0015_rls_references_user_metadata'),
          loc: p.loc,
        }),
      )
    }
    return findings
  },
}

/** RLS013 — an UPDATE policy with USING but no WITH CHECK leaves the write side open. */
export const updatePolicyMissingWithCheck: Rule = {
  id: 'RLS013',
  name: 'update_policy_missing_with_check',
  defaultSeverity: 'warning',
  description:
    'An UPDATE policy has USING but no WITH CHECK, so it does not constrain new row values.',
  docs: SUPABASE_RLS_DOCS,
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const p of livePolicies(state)) {
      if (p.command !== 'update' && p.command !== 'all') continue
      if (!p.hasUsing || p.hasCheck) continue
      if (isAllowlisted(config, p.schema, p.table)) continue
      findings.push(
        finding({
          ruleId: 'RLS013',
          ruleName: 'update_policy_missing_with_check',
          severity: 'warning',
          target: `${p.schema}.${p.table}`,
          message: `Policy "${p.name}" on ${p.schema}.${p.table} (${p.command.toUpperCase()}) has USING but no WITH CHECK, so it does not validate the new row values a user writes.`,
          fix: 'Add a WITH CHECK clause mirroring the USING condition.',
          docs: SUPABASE_RLS_DOCS,
          loc: p.loc,
        }),
      )
    }
    return findings
  },
}
