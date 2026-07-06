/**
 * Folds an ordered list of {@link Statement}s into a single {@link SchemaState}.
 *
 * This is the heart of the tool: migrations are cumulative and applied in
 * timestamp order, so a table created in `001` and RLS-enabled in `002` is
 * perfectly correct. Evaluating each file in isolation would false-positive.
 * We therefore replay every statement as a state transition and let the rules
 * inspect only the *final* state.
 */

import { aggregateExprs } from './policy.js'
import type {
  MaterializedViewState,
  SchemaState,
  SourceLocation,
  Statement,
  TableState,
} from './types.js'

/** True when a REVOKE fully covers a recorded grant (conservative: keep the grant if unsure). */
function revokeCovers(
  revoke: { privileges: string[] | 'all'; grantees: string[] },
  granted: { privileges: string[] | 'all'; grantees: string[] },
): boolean {
  // every grantee of the grant must be among those being revoked
  if (!granted.grantees.every((r) => revoke.grantees.includes(r))) return false
  if (revoke.privileges === 'all') return true
  if (granted.privileges === 'all') return false
  return granted.privileges.every((p) => revoke.privileges.includes(p))
}

export function tableKey(schema: string, name: string): string {
  return `${schema}.${name}`
}

export function createEmptyState(exposedSchemas: string[]): SchemaState {
  return {
    tables: new Map(),
    views: [],
    materializedViews: [],
    functions: [],
    schemas: new Set(['public']),
    exposedSchemas,
    rlsDisabledEvents: [],
    defaultPrivileges: [],
  }
}

/** Tables that exist (created and not dropped) in the given schema at this point of the fold. */
function liveTablesInSchema(state: SchemaState, schema: string): TableState[] {
  return [...state.tables.values()].filter((t) => t.created && !t.dropped && t.schema === schema)
}

function getOrCreateTable(
  state: SchemaState,
  schema: string,
  name: string,
  loc: SourceLocation,
): TableState {
  const key = tableKey(schema, name)
  let table = state.tables.get(key)
  if (!table) {
    table = {
      schema,
      name,
      created: false,
      rlsEnabled: false,
      rlsForced: false,
      dropped: false,
      columns: [],
      policies: [],
      grants: [],
      definedAt: loc,
    }
    state.tables.set(key, table)
    state.schemas.add(schema)
  }
  return table
}

function applyStatement(state: SchemaState, stmt: Statement): void {
  switch (stmt.kind) {
    case 'createSchema': {
      state.schemas.add(stmt.name)
      break
    }
    case 'createTable': {
      const table = getOrCreateTable(state, stmt.schema, stmt.name, stmt.loc)
      // `CREATE TABLE IF NOT EXISTS` on an already-created table is a no-op.
      if (table.created && stmt.ifNotExists) break
      table.created = true
      table.dropped = false
      table.columns = stmt.columns
      table.definedAt = stmt.loc
      // ALTER DEFAULT PRIVILEGES applies to tables created after it.
      for (const dp of state.defaultPrivileges) {
        if (dp.schemas.length === 0 || dp.schemas.includes(stmt.schema)) {
          table.grants.push({
            privileges: dp.privileges,
            grantees: dp.grantees,
            loc: dp.loc,
            via: 'defaultPrivileges',
          })
        }
      }
      break
    }
    case 'alterRls': {
      const table = getOrCreateTable(state, stmt.schema, stmt.name, stmt.loc)
      switch (stmt.action) {
        case 'enable':
          table.rlsEnabled = true
          break
        case 'disable':
          table.rlsEnabled = false
          state.rlsDisabledEvents.push({ schema: stmt.schema, name: stmt.name, loc: stmt.loc })
          break
        case 'force':
          table.rlsForced = true
          break
        case 'noforce':
          table.rlsForced = false
          break
      }
      break
    }
    case 'alterTableAddColumn': {
      const table = getOrCreateTable(state, stmt.schema, stmt.name, stmt.loc)
      if (!table.columns.some((c) => c.name === stmt.column.name)) {
        table.columns.push(stmt.column)
      }
      break
    }
    case 'createPolicy': {
      const p = stmt.policy
      const table = getOrCreateTable(state, p.schema, p.table, stmt.loc)
      // Replace a same-named policy (e.g. drop+recreate folded together).
      table.policies = table.policies.filter((existing) => existing.name !== p.name)
      table.policies.push(p)
      break
    }
    case 'dropPolicy': {
      const table = state.tables.get(tableKey(stmt.schema, stmt.table))
      if (table) {
        table.policies = table.policies.filter((p) => p.name !== stmt.name)
      }
      break
    }
    case 'alterPolicy': {
      const table = state.tables.get(tableKey(stmt.schema, stmt.table))
      const policy = table?.policies.find((p) => p.name === stmt.name)
      if (!policy) break
      if (stmt.roles !== undefined) policy.roles = stmt.roles
      if (stmt.usingExpr !== undefined) policy.usingExpr = stmt.usingExpr
      if (stmt.checkExpr !== undefined) policy.checkExpr = stmt.checkExpr
      Object.assign(policy, aggregateExprs(policy.usingExpr, policy.checkExpr))
      break
    }
    case 'grant': {
      for (const obj of stmt.objects) {
        const table = getOrCreateTable(state, obj.schema, obj.name, stmt.loc)
        if (stmt.isGrant) {
          table.grants.push({ privileges: stmt.privileges, grantees: stmt.grantees, loc: stmt.loc })
        } else {
          // REVOKE: drop the grants it fully covers (conservative).
          table.grants = table.grants.filter((g) => !revokeCovers(stmt, g))
        }
      }
      break
    }
    case 'grantAllInSchema': {
      // Real Postgres semantics: `GRANT/REVOKE ... ON ALL TABLES IN SCHEMA` is a
      // bulk per-table operation on the tables existing AT EXECUTION TIME.
      // (Future tables need ALTER DEFAULT PRIVILEGES — modeled separately.)
      for (const schema of stmt.schemas) {
        state.schemas.add(schema)
        for (const table of liveTablesInSchema(state, schema)) {
          if (stmt.isGrant) {
            table.grants.push({
              privileges: stmt.privileges,
              grantees: stmt.grantees,
              loc: stmt.loc,
              via: 'schemaGrant',
            })
          } else {
            // Cross-level by construction: this filters table-level grants too.
            table.grants = table.grants.filter((g) => !revokeCovers(stmt, g))
          }
        }
      }
      break
    }
    case 'alterDefaultPrivileges': {
      if (stmt.isGrant) {
        state.defaultPrivileges.push({
          schemas: stmt.schemas,
          privileges: stmt.privileges,
          grantees: stmt.grantees,
          loc: stmt.loc,
        })
      } else {
        // ALTER DEFAULT PRIVILEGES ... REVOKE: drop fully-covered defaults with the same scope.
        state.defaultPrivileges = state.defaultPrivileges.filter((dp) => {
          const sameScope =
            (dp.schemas.length === 0 && stmt.schemas.length === 0) ||
            dp.schemas.every((s) => stmt.schemas.includes(s))
          return !(sameScope && revokeCovers(stmt, dp))
        })
      }
      break
    }
    case 'createView': {
      state.schemas.add(stmt.schema)
      state.views = state.views.filter((v) => !(v.schema === stmt.schema && v.name === stmt.name))
      state.views.push({
        schema: stmt.schema,
        name: stmt.name,
        securityInvoker: stmt.securityInvoker,
        referencesAuthUsers: stmt.referencesAuthUsers,
        definedAt: stmt.loc,
      })
      break
    }
    case 'createMaterializedView': {
      state.schemas.add(stmt.schema)
      state.materializedViews = state.materializedViews.filter(
        (v) => !(v.schema === stmt.schema && v.name === stmt.name),
      )
      state.materializedViews.push({
        schema: stmt.schema,
        name: stmt.name,
        definedAt: stmt.loc,
      })
      break
    }
    case 'createFunction': {
      state.schemas.add(stmt.schema)
      state.functions = state.functions.filter(
        (f) => !(f.schema === stmt.schema && f.name === stmt.name),
      )
      state.functions.push({
        schema: stmt.schema,
        name: stmt.name,
        hasSearchPath: stmt.hasSearchPath,
        securityDefiner: stmt.securityDefiner,
        definedAt: stmt.loc,
      })
      break
    }
    case 'dropTable': {
      const table = state.tables.get(tableKey(stmt.schema, stmt.name))
      if (table) table.dropped = true
      break
    }
    case 'dropView': {
      state.views = state.views.filter((v) => !(v.schema === stmt.schema && v.name === stmt.name))
      break
    }
    case 'dropMaterializedView': {
      state.materializedViews = state.materializedViews.filter(
        (v) => !(v.schema === stmt.schema && v.name === stmt.name),
      )
      break
    }
    case 'dropFunction': {
      state.functions = state.functions.filter(
        (f) => !(f.schema === stmt.schema && f.name === stmt.name),
      )
      break
    }
    case 'other':
      break
  }
}

export function foldStatements(statements: Statement[], exposedSchemas: string[]): SchemaState {
  const state = createEmptyState(exposedSchemas)
  for (const stmt of statements) applyStatement(state, stmt)
  return state
}

/** Tables that are live (created here and not dropped) and sit in an API-exposed schema. */
export function exposedTables(state: SchemaState): TableState[] {
  return [...state.tables.values()].filter(
    (t) => t.created && !t.dropped && state.exposedSchemas.includes(t.schema),
  )
}

/** Materialized views that live in an API-exposed schema. */
export function exposedMaterializedViews(state: SchemaState): MaterializedViewState[] {
  return state.materializedViews.filter((v) => state.exposedSchemas.includes(v.schema))
}
