/**
 * Core type definitions shared across the parser, rule engine, and reporters.
 *
 * The parser layer turns raw SQL into a list of {@link Statement}s. The folder
 * ({@link ./schema-state}) reduces those statements into a single {@link SchemaState}
 * representing the *final* state of the database after every migration has been
 * applied in order. Rules then evaluate that final state and emit {@link Finding}s.
 */

export type Severity = 'critical' | 'warning' | 'info'

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

/** Postgres RLS policy command. */
export type PolicyCommand = 'select' | 'insert' | 'update' | 'delete' | 'all'

/** Where something lives in the source migrations. `line`/`column` are 1-based. */
export interface SourceLocation {
  /** Path relative to the scanned root (POSIX separators), e.g. `migrations/001_init.sql`. */
  file: string
  line: number
  column: number
  /** Byte offset of the statement within its file (for ordering/snippets). */
  offset: number
}

export interface ColumnInfo {
  name: string
  type: string
}

export interface TableRef {
  schema: string
  name: string
}

/** A reference to `auth.uid()` / `auth.jwt()` / `current_setting()` inside a policy expression. */
export interface AuthFnRef {
  /** e.g. `auth.uid`, `auth.jwt`, `current_setting`, `auth.role`. */
  name: string
  /** True when the call is wrapped in a subquery — `(select auth.uid())` — the performant form. */
  wrapped: boolean
}

/** Derived facts about a single policy expression (a `USING` or `WITH CHECK` clause). */
export interface ExprInfo {
  /** Whether the clause is present at all. */
  present: boolean
  /** The expression is always true (`true`, `1 = 1`, …). */
  alwaysTrue: boolean
  authFns: AuthFnRef[]
  referencesUserMetadata: boolean
}

/** Fully normalized view of a single `CREATE POLICY` statement. */
export interface PolicyInfo {
  name: string
  schema: string
  table: string
  command: PolicyCommand
  /** Role names the policy applies to; `'public'` represents `TO public` / a missing `TO` clause. */
  roles: string[]
  /** `true` for PERMISSIVE (default), `false` for `AS RESTRICTIVE`. */
  permissive: boolean
  /** Per-clause descriptors (kept so `ALTER POLICY` can patch a single clause). */
  usingExpr: ExprInfo
  checkExpr: ExprInfo
  // Aggregate fields derived from usingExpr/checkExpr (see core/policy.ts).
  hasUsing: boolean
  hasCheck: boolean
  usingAlwaysTrue: boolean
  checkAlwaysTrue: boolean
  authFns: AuthFnRef[]
  referencesUserMetadata: boolean
  loc: SourceLocation
}

interface Base {
  loc: SourceLocation
  /** The raw SQL text of this statement (trimmed), used for snippets in reporters. */
  raw: string
}

export type Statement =
  | (Base & {
      kind: 'createTable'
      schema: string
      name: string
      ifNotExists: boolean
      columns: ColumnInfo[]
    })
  | (Base & {
      kind: 'alterRls'
      schema: string
      name: string
      action: 'enable' | 'disable' | 'force' | 'noforce'
    })
  | (Base & { kind: 'alterTableAddColumn'; schema: string; name: string; column: ColumnInfo })
  | (Base & { kind: 'createPolicy'; policy: PolicyInfo })
  | (Base & { kind: 'dropPolicy'; schema: string; table: string; name: string })
  | (Base & {
      kind: 'alterPolicy'
      schema: string
      table: string
      name: string
      /** Present only if the `ALTER POLICY` specified that clause; otherwise leave unchanged. */
      roles?: string[]
      usingExpr?: ExprInfo
      checkExpr?: ExprInfo
    })
  | (Base & {
      kind: 'grant'
      isGrant: boolean
      privileges: string[] | 'all'
      objects: TableRef[]
      grantees: string[]
    })
  | (Base & {
      kind: 'grantAllInSchema'
      isGrant: boolean
      privileges: string[] | 'all'
      schemas: string[]
      grantees: string[]
    })
  | (Base & {
      kind: 'createView'
      schema: string
      name: string
      securityInvoker: boolean
      referencesAuthUsers: boolean
    })
  | (Base & { kind: 'createMaterializedView'; schema: string; name: string })
  | (Base & { kind: 'createForeignTable'; schema: string; name: string })
  | (Base & {
      kind: 'createFunction'
      schema: string
      name: string
      hasSearchPath: boolean
      securityDefiner: boolean
    })
  | (Base & { kind: 'dropTable'; schema: string; name: string })
  | (Base & { kind: 'dropView'; schema: string; name: string })
  | (Base & { kind: 'dropMaterializedView'; schema: string; name: string })
  | (Base & { kind: 'dropForeignTable'; schema: string; name: string })
  | (Base & { kind: 'dropFunction'; schema: string; name: string })
  | (Base & {
      kind: 'alterDefaultPrivileges'
      isGrant: boolean
      privileges: string[] | 'all'
      /** Schemas the default applies to; empty = all schemas. */
      schemas: string[]
      grantees: string[]
    })
  | (Base & { kind: 'createSchema'; name: string })
  | (Base & { kind: 'other' })

// ---------------------------------------------------------------------------
// Aggregated schema state (the folded result of every migration in order)
// ---------------------------------------------------------------------------

export interface GrantState {
  privileges: string[] | 'all'
  grantees: string[]
  loc: SourceLocation
  /** Set when the grant was applied indirectly (schema-wide grant / default privileges). */
  via?: 'schemaGrant' | 'defaultPrivileges'
}

/** An `ALTER DEFAULT PRIVILEGES … GRANT … ON TABLES TO …` — applies to tables created later. */
export interface DefaultPrivilegeState {
  /** Schemas the default applies to; empty = all schemas. */
  schemas: string[]
  privileges: string[] | 'all'
  grantees: string[]
  loc: SourceLocation
}

export interface TableState {
  schema: string
  name: string
  /** True only when a `CREATE TABLE` for this table appears in the scanned migrations. */
  created: boolean
  rlsEnabled: boolean
  rlsForced: boolean
  /** True once a `DROP TABLE` removed it (rules skip dropped tables). */
  dropped: boolean
  columns: ColumnInfo[]
  policies: PolicyInfo[]
  grants: GrantState[]
  definedAt: SourceLocation
}

export interface ViewState {
  schema: string
  name: string
  securityInvoker: boolean
  /** True when the view's definition selects from `auth.users` (RLS015). */
  referencesAuthUsers: boolean
  definedAt: SourceLocation
}

export interface MaterializedViewState {
  schema: string
  name: string
  definedAt: SourceLocation
}

export interface ForeignTableState {
  schema: string
  name: string
  definedAt: SourceLocation
}

export interface FunctionState {
  schema: string
  name: string
  hasSearchPath: boolean
  securityDefiner: boolean
  definedAt: SourceLocation
}

export interface RlsToggleEvent {
  schema: string
  name: string
  loc: SourceLocation
}

export interface SchemaState {
  /** Keyed by `${schema}.${name}`. */
  tables: Map<string, TableState>
  views: ViewState[]
  materializedViews: MaterializedViewState[]
  foreignTables: ForeignTableState[]
  functions: FunctionState[]
  schemas: Set<string>
  /** Schemas exposed over the Data API (default `['public']`). */
  exposedSchemas: string[]
  /** Every `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` seen, in order (for RLS018). */
  rlsDisabledEvents: RlsToggleEvent[]
  /** Active `ALTER DEFAULT PRIVILEGES` grants, applied to tables created after them. */
  defaultPrivileges: DefaultPrivilegeState[]
}

// ---------------------------------------------------------------------------
// Findings & rules
// ---------------------------------------------------------------------------

export interface Finding {
  ruleId: string
  /** Splinter-aligned machine name, e.g. `rls_disabled_in_public`. */
  ruleName: string
  severity: Severity
  /** Human message. */
  message: string
  /** Object the finding is about, e.g. `public.users`. */
  target: string
  loc: SourceLocation
  /** Suggested fix (a line of SQL or guidance). */
  fix?: string
  /** Documentation URL. */
  docs?: string
}

export interface RuleMeta {
  id: string
  name: string
  defaultSeverity: Severity
  /** One-line description shown in `--list-rules` and docs. */
  description: string
  docs?: string
  /** Splinter lint code this corresponds to, if any (e.g. `0013`). */
  splinter?: string
}

export interface Rule extends RuleMeta {
  /** Evaluate the rule against the final schema state. */
  evaluate(ctx: RuleContext): Finding[]
}

export interface RuleContext {
  state: SchemaState
  config: ResolvedConfig
  /** All statements in application order (rules that inspect the migration *history*). */
  statements: Statement[]
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SensitiveColumnConfig {
  critical: string[]
  warning: string[]
  info: string[]
}

/** User-facing config (all fields optional; merged over defaults). */
export interface UserConfig {
  exposedSchemas?: string[]
  /** Tables intentionally world-readable; `schema.table` or bare `table`. */
  publicTables?: string[]
  sensitiveColumns?: Partial<SensitiveColumnConfig>
  /** Rule ids to disable entirely. */
  disabledRules?: string[]
  /** Override a rule's severity, e.g. `{ RLS010: "warning" }`. */
  severity?: Record<string, Severity>
  /** Gate threshold: findings at or above this severity cause a non-zero exit. Default `critical`. */
  failOn?: Severity
}

export interface ResolvedConfig {
  exposedSchemas: string[]
  publicTables: string[]
  sensitiveColumns: SensitiveColumnConfig
  disabledRules: Set<string>
  severity: Record<string, Severity>
  failOn: Severity
  /** Source path the config was loaded from, if any. */
  configPath?: string
  /** Non-fatal problems found while loading config (invalid fields, etc.). */
  warnings: string[]
}

export type OutputFormat = 'text' | 'json' | 'github' | 'sarif'

export interface ScanSummary {
  critical: number
  warning: number
  info: number
  total: number
  filesScanned: number
  /** True when at least one finding is at or above the `failOn` threshold. */
  failed: boolean
}

export interface ScanResult {
  findings: Finding[]
  summary: ScanSummary
  config: ResolvedConfig
  /** Non-fatal warnings surfaced during the scan (config + parser fallbacks). */
  warnings: string[]
}
