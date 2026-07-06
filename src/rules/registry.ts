import type { Finding, Rule, RuleContext, RuleMeta } from '../core/types.js'
import { broadGrantToAnon } from './grants.js'
import {
  authUsersExposed,
  functionSearchPathMutable,
  materializedViewInApi,
  securityDefinerView,
} from './objects.js'
import {
  authUidNotWrapped,
  multiplePermissivePolicies,
  policyMissingRole,
  policyReferencesUserMetadata,
  policyUsesAuthRole,
  policyUsingTrue,
  updatePolicyMissingWithCheck,
} from './policies.js'
import {
  disableRlsInMigration,
  policyExistsRlsDisabled,
  rlsDisabledInPublic,
  rlsEnabledNoPolicy,
} from './rls-enablement.js'
import { sensitiveColumnUnprotected } from './sensitive-columns.js'

/** Every rule, ordered by id. */
export const ALL_RULES: Rule[] = [
  rlsDisabledInPublic, // RLS001
  rlsEnabledNoPolicy, // RLS002
  policyExistsRlsDisabled, // RLS003
  sensitiveColumnUnprotected, // RLS004
  broadGrantToAnon, // RLS005
  policyUsingTrue, // RLS006
  policyMissingRole, // RLS007
  authUidNotWrapped, // RLS008
  policyReferencesUserMetadata, // RLS009
  securityDefinerView, // RLS010
  functionSearchPathMutable, // RLS011
  materializedViewInApi, // RLS012
  updatePolicyMissingWithCheck, // RLS013
  authUsersExposed, // RLS015
  policyUsesAuthRole, // RLS016
  multiplePermissivePolicies, // RLS017
  disableRlsInMigration, // RLS018
]

export function ruleList(): RuleMeta[] {
  return ALL_RULES.map(({ id, name, defaultSeverity, description, docs, splinter }) => ({
    id,
    name,
    defaultSeverity,
    description,
    docs,
    splinter,
  }))
}

/** Run every enabled rule and apply user severity overrides. */
export function evaluateRules(ctx: RuleContext): Finding[] {
  const findings: Finding[] = []
  for (const rule of ALL_RULES) {
    if (ctx.config.disabledRules.has(rule.id)) continue
    for (const f of rule.evaluate(ctx)) {
      const override = ctx.config.severity[f.ruleId]
      findings.push(override ? { ...f, severity: override } : f)
    }
  }
  return findings
}
