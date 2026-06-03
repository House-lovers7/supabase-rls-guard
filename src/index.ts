/**
 * Public library API for supabase-rls-guard.
 *
 * @example
 * ```ts
 * import { scan } from 'supabase-rls-guard'
 * const result = await scan({ path: 'supabase/migrations' })
 * console.log(result.summary)
 * ```
 */

export type { ConfigOverrides } from './config/load.js'
export { loadConfig } from './config/load.js'
export type { MigrationFile } from './core/discover.js'
export { discover } from './core/discover.js'
export type { ScanOptions } from './core/scan.js'
export { scan } from './core/scan.js'
export {
  createEmptyState,
  exposedTables,
  foldStatements,
  tableKey,
} from './core/schema-state.js'
export type * from './core/types.js'
export type { BackendChoice, ParseError, ParseResult } from './parser/index.js'
export { parseSql } from './parser/index.js'
export { render } from './reporters/index.js'
export { ALL_RULES, evaluateRules, ruleList } from './rules/registry.js'
export { HOMEPAGE, TOOL_NAME, VERSION } from './version.js'
