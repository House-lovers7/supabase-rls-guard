import { exposedMaterializedViews } from '../core/schema-state.js'
import type { Finding, Rule } from '../core/types.js'
import { finding, isAllowlisted, splinterDocs } from './util.js'

/** RLS015 — a view in an exposed schema that selects from `auth.users` leaks user PII. */
export const authUsersExposed: Rule = {
  id: 'RLS015',
  name: 'auth_users_exposed',
  defaultSeverity: 'critical',
  splinter: '0002',
  description: 'A view in an exposed schema selects from auth.users, leaking user PII to the API.',
  docs: splinterDocs('0002_auth_users_exposed'),
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const v of state.views) {
      if (!state.exposedSchemas.includes(v.schema)) continue
      if (!v.referencesAuthUsers || isAllowlisted(config, v.schema, v.name)) continue
      findings.push(
        finding({
          ruleId: 'RLS015',
          ruleName: 'auth_users_exposed',
          severity: 'critical',
          target: `${v.schema}.${v.name}`,
          message: `View ${v.schema}.${v.name} selects from auth.users and is in an API-exposed schema — it can leak user emails and other PII to the API.`,
          fix: 'Do not expose auth.users via a view. Select only the non-sensitive columns you need into your own table, or restrict access.',
          docs: splinterDocs('0002_auth_users_exposed'),
          loc: v.definedAt,
        }),
      )
    }
    return findings
  },
}

/** RLS010 — a view in an exposed schema without `security_invoker` bypasses the caller's RLS. */
export const securityDefinerView: Rule = {
  id: 'RLS010',
  name: 'security_definer_view',
  defaultSeverity: 'critical',
  splinter: '0010',
  description: "A view runs with definer rights and bypasses the querying user's RLS.",
  docs: splinterDocs('0010_security_definer_view'),
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const v of state.views) {
      if (!state.exposedSchemas.includes(v.schema)) continue
      if (v.securityInvoker || isAllowlisted(config, v.schema, v.name)) continue
      findings.push(
        finding({
          ruleId: 'RLS010',
          ruleName: 'security_definer_view',
          severity: 'critical',
          target: `${v.schema}.${v.name}`,
          message: `View ${v.schema}.${v.name} is not security_invoker, so it runs with the creator's privileges and bypasses the querying user's RLS.`,
          fix: `ALTER VIEW ${v.schema}.${v.name} SET (security_invoker = on);`,
          docs: splinterDocs('0010_security_definer_view'),
          loc: v.definedAt,
        }),
      )
    }
    return findings
  },
}

/** RLS012 — a materialized view in an exposed schema is API-readable but cannot carry RLS. */
export const materializedViewInApi: Rule = {
  id: 'RLS012',
  name: 'materialized_view_in_api',
  defaultSeverity: 'critical',
  splinter: '0016',
  description:
    'A materialized view in an API-exposed schema can be served by the API but cannot carry RLS.',
  docs: splinterDocs('0016_materialized_view_in_api'),
  evaluate({ state, config }) {
    const findings: Finding[] = []
    for (const v of exposedMaterializedViews(state)) {
      if (isAllowlisted(config, v.schema, v.name)) continue
      findings.push(
        finding({
          ruleId: 'RLS012',
          ruleName: 'materialized_view_in_api',
          severity: 'critical',
          target: `${v.schema}.${v.name}`,
          message: `Materialized view ${v.schema}.${v.name} is in an API-exposed schema but cannot carry Row Level Security policies.`,
          fix: 'Move the materialized view to a non-exposed schema, expose a security_invoker view over it, or restrict API role privileges.',
          docs: splinterDocs('0016_materialized_view_in_api'),
          loc: v.definedAt,
        }),
      )
    }
    return findings
  },
}

/** RLS011 — a function without a fixed `search_path` is vulnerable to hijacking. */
export const functionSearchPathMutable: Rule = {
  id: 'RLS011',
  name: 'function_search_path_mutable',
  defaultSeverity: 'warning',
  splinter: '0011',
  description: 'A function does not set search_path, allowing object-resolution hijacking.',
  docs: splinterDocs('0011_function_search_path_mutable'),
  evaluate({ state }) {
    const findings: Finding[] = []
    for (const f of state.functions) {
      if (!state.exposedSchemas.includes(f.schema)) continue
      if (f.hasSearchPath) continue
      findings.push(
        finding({
          ruleId: 'RLS011',
          ruleName: 'function_search_path_mutable',
          severity: 'warning',
          target: `${f.schema}.${f.name}`,
          message: `Function ${f.schema}.${f.name} has a mutable search_path${f.securityDefiner ? ' and is SECURITY DEFINER' : ''}, which can let an attacker hijack unqualified object references.`,
          fix: `ALTER FUNCTION ${f.schema}.${f.name} SET search_path = ''; -- and fully-qualify object names`,
          docs: splinterDocs('0011_function_search_path_mutable'),
          loc: f.definedAt,
        }),
      )
    }
    return findings
  },
}
