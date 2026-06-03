/**
 * Folds an ordered list of {@link Statement}s into a single {@link SchemaState}.
 *
 * This is the heart of the tool: migrations are cumulative and applied in
 * timestamp order, so a table created in `001` and RLS-enabled in `002` is
 * perfectly correct. Evaluating each file in isolation would false-positive.
 * We therefore replay every statement as a state transition and let the rules
 * inspect only the *final* state.
 */

import type { SchemaState, SourceLocation, Statement, TableState } from './types.js'

export function tableKey(schema: string, name: string): string {
  return `${schema}.${name}`
}

export function createEmptyState(exposedSchemas: string[]): SchemaState {
  return {
    tables: new Map(),
    views: [],
    functions: [],
    schemas: new Set(['public']),
    exposedSchemas,
    rlsDisabledEvents: [],
  }
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
    case 'grant': {
      if (!stmt.isGrant) break
      for (const obj of stmt.objects) {
        const table = getOrCreateTable(state, obj.schema, obj.name, stmt.loc)
        table.grants.push({ privileges: stmt.privileges, grantees: stmt.grantees, loc: stmt.loc })
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
