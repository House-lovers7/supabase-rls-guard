import type { ExprInfo, PolicyInfo } from './types.js'

export const EMPTY_EXPR: ExprInfo = {
  present: false,
  alwaysTrue: false,
  authFns: [],
  referencesUserMetadata: false,
}

type AggregateFields = Pick<
  PolicyInfo,
  | 'hasUsing'
  | 'hasCheck'
  | 'usingAlwaysTrue'
  | 'checkAlwaysTrue'
  | 'authFns'
  | 'referencesUserMetadata'
>

/**
 * Derives a policy's aggregate fields from its two per-clause descriptors.
 * Keeping clauses separate lets `ALTER POLICY` replace a single clause and
 * recompute the aggregate correctly.
 */
export function aggregateExprs(usingExpr: ExprInfo, checkExpr: ExprInfo): AggregateFields {
  return {
    hasUsing: usingExpr.present,
    hasCheck: checkExpr.present,
    usingAlwaysTrue: usingExpr.present && usingExpr.alwaysTrue,
    checkAlwaysTrue: checkExpr.present && checkExpr.alwaysTrue,
    authFns: [...usingExpr.authFns, ...checkExpr.authFns],
    referencesUserMetadata: usingExpr.referencesUserMetadata || checkExpr.referencesUserMetadata,
  }
}
