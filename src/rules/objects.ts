import type { Finding, Rule } from '../core/types.js'
import { finding, isAllowlisted, splinterDocs } from './util.js'

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
