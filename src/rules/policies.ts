import type { Finding, PolicyCommand, PolicyInfo, Rule, SchemaState } from '../core/types.js'
import { finding, isAllowlisted, SUPABASE_RLS_DOCS, splinterDocs } from './util.js'

const DML_COMMANDS: PolicyCommand[] = ['select', 'insert', 'update', 'delete']

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

/**
 * RLS013 — an UPDATE/ALL policy omits WITH CHECK. Postgres then reuses the USING
 * expression as the new-row check, so this is usually safe; the lint is a gentle
 * nudge to be explicit when the write constraint should differ from the read one.
 */
export const updatePolicyMissingWithCheck: Rule = {
  id: 'RLS013',
  name: 'update_policy_missing_with_check',
  defaultSeverity: 'info',
  description:
    'An UPDATE policy omits WITH CHECK; Postgres reuses USING as the new-row check. Be explicit if the write constraint should differ.',
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
          severity: 'info',
          target: `${p.schema}.${p.table}`,
          message: `Policy "${p.name}" on ${p.schema}.${p.table} (${p.command.toUpperCase()}) omits WITH CHECK — Postgres reuses the USING expression to validate new rows. Add an explicit WITH CHECK only if the write constraint should differ from the read constraint.`,
          fix: 'Optional: add an explicit WITH CHECK clause if new rows need a different condition than USING.',
          docs: SUPABASE_RLS_DOCS,
          loc: p.loc,
        }),
      )
    }
    return findings
  },
}

/**
 * RLS017 — two or more permissive policies overlap on the same role and command.
 * Postgres evaluates (ORs) every permissive policy on each matching row, so
 * overlapping policies are a performance footgun (same family as RLS008).
 */
export const multiplePermissivePolicies: Rule = {
  id: 'RLS017',
  name: 'multiple_permissive_policies',
  defaultSeverity: 'warning',
  splinter: '0006',
  description: 'Multiple permissive policies for the same role and command are OR-ed on every row.',
  docs: splinterDocs('0006_multiple_permissive_policies'),
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const t of state.tables.values()) {
      if (t.dropped || isAllowlisted(config, t.schema, t.name)) continue

      // Bucket permissive policies by `${command}|${role}` (expanding `all`).
      const buckets = new Map<string, PolicyInfo[]>()
      for (const p of t.policies) {
        if (!p.permissive) continue
        const commands = p.command === 'all' ? DML_COMMANDS : [p.command]
        for (const cmd of commands) {
          for (const role of p.roles) {
            const key = `${cmd}|${role}`
            const arr = buckets.get(key) ?? []
            if (!arr.some((q) => q.name === p.name)) arr.push(p)
            buckets.set(key, arr)
          }
        }
      }

      // Report once per (role, set of overlapping policy names) — two `all`
      // policies overlap on every command but are a single problem.
      const seen = new Set<string>()
      for (const [key, policies] of buckets) {
        if (policies.length < 2) continue
        const role = key.split('|')[1] ?? 'public'
        const names = policies.map((p) => p.name).sort()
        const dedupKey = `${role}|${names.join(',')}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)
        const last = policies[policies.length - 1]
        findings.push(
          finding({
            ruleId: 'RLS017',
            ruleName: 'multiple_permissive_policies',
            severity: 'warning',
            target: `${t.schema}.${t.name}`,
            message: `Table ${t.schema}.${t.name} has ${names.length} permissive policies for role "${role}" overlapping on the same command (${names.map((n) => `"${n}"`).join(', ')}). Postgres evaluates (ORs) all of them on every matching row.`,
            fix: 'Merge the overlapping permissive policies into one, or make some RESTRICTIVE.',
            docs: splinterDocs('0006_multiple_permissive_policies'),
            loc: (last ?? policies[0])?.loc ?? t.definedAt,
          }),
        )
      }
    }
    return findings
  },
}

/**
 * RLS016 — a policy gates on `auth.role()` inside its predicate. The native
 * `TO <role>` clause is the more reliable mechanism (Postgres applies it before
 * evaluating the expression). Informational, since `auth.role()` has legitimate
 * uses in compound conditions.
 */
export const policyUsesAuthRole: Rule = {
  id: 'RLS016',
  name: 'rls_uses_auth_role',
  defaultSeverity: 'info',
  description: 'A policy gates on auth.role() in its predicate; prefer the TO clause.',
  docs: SUPABASE_RLS_DOCS,
  evaluate({ state }) {
    const findings: Finding[] = []
    for (const p of livePolicies(state)) {
      if (!p.authFns.some((f) => f.name === 'auth.role')) continue
      findings.push(
        finding({
          ruleId: 'RLS016',
          ruleName: 'rls_uses_auth_role',
          severity: 'info',
          target: `${p.schema}.${p.table}`,
          message: `Policy "${p.name}" on ${p.schema}.${p.table} gates on auth.role() in its expression. Prefer the native TO clause (e.g. TO authenticated), which Postgres applies before evaluating the policy.`,
          fix: "Replace `auth.role() = 'authenticated'`-style checks with a `TO authenticated` clause.",
          docs: SUPABASE_RLS_DOCS,
          loc: p.loc,
        }),
      )
    }
    return findings
  },
}
