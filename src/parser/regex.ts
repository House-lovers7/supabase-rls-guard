/**
 * Fallback parser backend used only when libpg-query cannot parse a file
 * (e.g. bleeding-edge syntax the bundled Postgres grammar predates). It is a
 * best-effort heuristic matcher over the comment/dollar-quote-aware statement
 * splitter — less precise than the AST backend, but resilient.
 */

import { LineIndex } from '../core/location.js'
import { aggregateExprs, EMPTY_EXPR } from '../core/policy.js'
import type {
  AuthFnRef,
  ColumnInfo,
  ExprInfo,
  PolicyCommand,
  PolicyInfo,
  SourceLocation,
  Statement,
} from '../core/types.js'
import {
  AUTH_FUNCTIONS,
  type ParseResult,
  type ParserBackend,
  USER_METADATA_RE,
} from './backend.js'
import { splitStatements } from './splitter.js'
import { extractParenAfter, isTextAlwaysTrue, parseQualifiedName } from './sql-text.js'

const COMMAND_RE = /\bfor\s+(select|insert|update|delete|all)\b/i

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inQuote = false
  let current = ''
  for (const ch of body) {
    if (ch === '"') inQuote = !inQuote
    if (!inQuote) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) {
        parts.push(current)
        current = ''
        continue
      }
    }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

function parseColumns(body: string | undefined): ColumnInfo[] {
  if (!body) return []
  const cols: ColumnInfo[] = []
  for (const segment of splitTopLevelCommas(body)) {
    const s = segment.trim()
    if (!s || /^(constraint|primary|unique|foreign|check|exclude|like)\b/i.test(s)) continue
    const m = /^("([^"]+)"|[\w$]+)\s+(.*)$/.exec(s)
    if (!m) continue
    const name = m[2] ?? m[1] ?? ''
    cols.push({ name, type: (m[3] ?? '').trim().split(/\s+/)[0] ?? 'unknown' })
  }
  return cols
}

/**
 * Returns, for every position in `clause`, whether that position sits inside a
 * still-open `( select …` scope. Mirrors the libpg backend's SubLink-scoped
 * "wrapped" detection (a closed earlier subquery must not count).
 */
function selectScopeMap(clause: string): boolean[] {
  const inSelect: boolean[] = new Array(clause.length)
  const stack: boolean[] = []
  for (let i = 0; i < clause.length; i++) {
    inSelect[i] = stack.includes(true)
    const c = clause[i]
    if (c === '(') {
      stack.push(/^\(\s*select\b/i.test(clause.slice(i)))
    } else if (c === ')') {
      stack.pop()
    }
  }
  return inSelect
}

function authFnsFromText(clause: string | undefined, acc: AuthFnRef[]): void {
  if (!clause) return
  const inSelect = selectScopeMap(clause)
  for (const fn of AUTH_FUNCTIONS) {
    // Identifier-boundary match: `auth.role` must not match inside `my_auth.role_check`.
    const re = new RegExp(`(?<![\\w.])${fn.replace(/\./g, '\\.')}\\s*\\(`, 'gi')
    for (const m of clause.matchAll(re)) {
      acc.push({ name: fn, wrapped: inSelect[m.index] === true })
    }
  }
}

/** Build an {@link ExprInfo} from a clause's text (regex backend). */
function describeText(clause: string | undefined): ExprInfo {
  if (clause === undefined) return EMPTY_EXPR
  const authFns: AuthFnRef[] = []
  authFnsFromText(clause, authFns)
  return {
    present: true,
    alwaysTrue: isTextAlwaysTrue(clause),
    authFns,
    referencesUserMetadata: USER_METADATA_RE.test(clause),
  }
}

/** Extracts the `TO <roles>` list from a policy/alter header, or `undefined` if absent. */
function parseRoles(header: string): string[] | undefined {
  const toMatch = /\bto\s+([\s\S]+?)\s*$/i.exec(
    header.replace(/\bas\s+(permissive|restrictive)\b/i, ''),
  )
  if (!toMatch) return undefined
  const roles = (toMatch[1] ?? '')
    .split(',')
    .map((r) => r.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
  return roles.length > 0 ? roles : undefined
}

function parsePolicy(text: string, loc: SourceLocation): PolicyInfo | undefined {
  const m = /^create\s+policy\s+("[^"]+"|[\w]+)\s+on\s+("?[\w".]+"?)([\s\S]*)$/i.exec(text)
  if (!m) return undefined
  const name = (m[1] ?? '').replace(/^"|"$/g, '')
  const table = parseQualifiedName(m[2] ?? '')
  const rest = m[3] ?? ''
  const clauseIdx = rest.search(/\busing\b|\bwith\s+check\b/i)
  const header = clauseIdx >= 0 ? rest.slice(0, clauseIdx) : rest

  const permissive = !/\bas\s+restrictive\b/i.test(header)
  const command = (COMMAND_RE.exec(header)?.[1]?.toLowerCase() ?? 'all') as PolicyCommand
  const usingExpr = describeText(extractParenAfter(rest, /\busing\b/i))
  const checkExpr = describeText(extractParenAfter(rest, /\bwith\s+check\b/i))

  return {
    name,
    schema: table.schema,
    table: table.name,
    command,
    roles: parseRoles(header) ?? ['public'],
    permissive,
    usingExpr,
    checkExpr,
    ...aggregateExprs(usingExpr, checkExpr),
    loc,
  }
}

function normalize(text: string, loc: SourceLocation): Statement[] {
  const raw = text.trim()
  const base = { loc, raw }
  // Strip *all* leading comment lines / block comments and surrounding whitespace.
  const stripped = raw.replace(/^(?:\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/))*\s*/, '')

  const tableMatch = /^create\s+table\s+(if\s+not\s+exists\s+)?("?[\w".]+"?)/i.exec(stripped)
  if (tableMatch) {
    const ref = parseQualifiedName(tableMatch[2] ?? '')
    const body = extractParenAfter(
      stripped,
      /^create\s+table\s+(?:if\s+not\s+exists\s+)?"?[\w".]+"?/i,
    )
    return [
      {
        kind: 'createTable',
        schema: ref.schema,
        name: ref.name,
        ifNotExists: Boolean(tableMatch[1]),
        columns: parseColumns(body),
        ...base,
      },
    ]
  }

  const alterMatch =
    /^alter\s+table\s+(?:if\s+exists\s+)?("?[\w".]+"?)\s+(enable|disable|force|no\s+force)\s+row\s+level\s+security/i.exec(
      stripped,
    )
  if (alterMatch) {
    const ref = parseQualifiedName(alterMatch[1] ?? '')
    const action = (alterMatch[2] ?? '').toLowerCase().replace(/\s+/g, '') as
      | 'enable'
      | 'disable'
      | 'force'
      | 'noforce'
    return [{ kind: 'alterRls', schema: ref.schema, name: ref.name, action, ...base }]
  }

  // ALTER TABLE ... ADD [COLUMN] — may carry several comma-separated ADD commands.
  const alterTableMatch = /^alter\s+table\s+(?:if\s+exists\s+)?("?[\w".]+"?)\s+([\s\S]+)$/i.exec(
    stripped,
  )
  if (alterTableMatch && /^add\b/i.test((alterTableMatch[2] ?? '').trim())) {
    const ref = parseQualifiedName(alterTableMatch[1] ?? '')
    const added: Statement[] = []
    for (const segment of splitTopLevelCommas(alterTableMatch[2] ?? '')) {
      const m = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("([^"]+)"|[\w$]+)\s+(\S+)/i.exec(
        segment.trim(),
      )
      if (!m) continue
      const name = m[2] ?? m[1] ?? ''
      // Skip constraint forms like ADD CONSTRAINT / ADD PRIMARY KEY etc.
      if (/^(constraint|primary|unique|foreign|check|exclude)$/i.test(name)) continue
      added.push({
        kind: 'alterTableAddColumn',
        schema: ref.schema,
        name: ref.name,
        column: { name, type: (m[3] ?? 'unknown').replace(/,+$/, '') },
        ...base,
      })
    }
    if (added.length > 0) return added
  }

  if (/^create\s+policy\b/i.test(stripped)) {
    const policy = parsePolicy(stripped, loc)
    return policy ? [{ kind: 'createPolicy', policy, ...base }] : [{ kind: 'other', ...base }]
  }

  const alterPolicyMatch = /^alter\s+policy\s+("[^"]+"|[\w]+)\s+on\s+("?[\w".]+"?)([\s\S]*)$/i.exec(
    stripped,
  )
  if (alterPolicyMatch) {
    const ref = parseQualifiedName(alterPolicyMatch[2] ?? '')
    const rest = alterPolicyMatch[3] ?? ''
    // `ALTER POLICY ... RENAME TO x` is a rename, not a clause patch — its `TO`
    // must not be read as a roles list. Match libpg (RenameStmt → other): leave
    // the existing policy state untouched.
    if (/^\s*rename\s+to\b/i.test(rest)) {
      return [{ kind: 'other', ...base }]
    }
    const clauseIdx = rest.search(/\busing\b|\bwith\s+check\b/i)
    const header = clauseIdx >= 0 ? rest.slice(0, clauseIdx) : rest
    const usingText = extractParenAfter(rest, /\busing\b/i)
    const checkText = extractParenAfter(rest, /\bwith\s+check\b/i)
    return [
      {
        kind: 'alterPolicy',
        schema: ref.schema,
        table: ref.name,
        name: (alterPolicyMatch[1] ?? '').replace(/^"|"$/g, ''),
        roles: parseRoles(header),
        usingExpr: usingText !== undefined ? describeText(usingText) : undefined,
        checkExpr: checkText !== undefined ? describeText(checkText) : undefined,
        ...base,
      },
    ]
  }

  const dropPolicyMatch =
    /^drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[\w]+)\s+on\s+("?[\w".]+"?)/i.exec(stripped)
  if (dropPolicyMatch) {
    const ref = parseQualifiedName(dropPolicyMatch[2] ?? '')
    return [
      {
        kind: 'dropPolicy',
        schema: ref.schema,
        table: ref.name,
        name: (dropPolicyMatch[1] ?? '').replace(/^"|"$/g, ''),
        ...base,
      },
    ]
  }

  const privList = (text: string): string[] | 'all' => {
    const lower = text.toLowerCase()
    return /\ball\b/.test(lower)
      ? 'all'
      : lower
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
  }
  const roleList = (text: string): string[] =>
    text
      .replace(/\bwith\s+grant\s+option\b/i, '')
      .split(',')
      .map((r) => r.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
  const schemaList = (text: string): string[] =>
    text
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)

  // `REVOKE GRANT OPTION FOR ...` removes only the re-grant ability; the
  // privilege itself survives — leave the folded state untouched (libpg parity).
  if (/^revoke\s+grant\s+option\s+for\b/i.test(stripped)) {
    return [{ kind: 'other', ...base }]
  }

  // ALTER DEFAULT PRIVILEGES [IN SCHEMA s[, ...]] GRANT|REVOKE <privs> ON TABLES TO|FROM <roles>
  const adpMatch =
    /^alter\s+default\s+privileges\b([\s\S]*?)\b(grant|revoke)\s+([\s\S]+?)\s+on\s+tables\s+(?:to|from)\s+([\s\S]+)$/i.exec(
      stripped,
    )
  if (adpMatch) {
    const scope = adpMatch[1] ?? ''
    const schemasMatch = /\bin\s+schema\s+([\w",\s]+?)\s*$/i.exec(scope)
    return [
      {
        kind: 'alterDefaultPrivileges',
        isGrant: (adpMatch[2] ?? '').toLowerCase() === 'grant',
        privileges: privList(adpMatch[3] ?? ''),
        schemas: schemasMatch ? schemaList(schemasMatch[1] ?? '') : [],
        grantees: roleList(adpMatch[4] ?? ''),
        ...base,
      },
    ]
  }

  const revokeAllMatch =
    /^revoke\s+([\s\S]+?)\s+on\s+all\s+tables\s+in\s+schema\s+([\w",\s]+?)\s+from\s+([\s\S]+)$/i.exec(
      stripped,
    )
  if (revokeAllMatch) {
    return [
      {
        kind: 'grantAllInSchema',
        isGrant: false,
        privileges: privList(revokeAllMatch[1] ?? ''),
        schemas: schemaList(revokeAllMatch[2] ?? ''),
        grantees: roleList(revokeAllMatch[3] ?? ''),
        ...base,
      },
    ]
  }

  const revokeMatch =
    /^revoke\s+([\s\S]+?)\s+on\s+(?:table\s+)?("?[\w".]+"?)\s+from\s+([\s\S]+)$/i.exec(stripped)
  if (revokeMatch) {
    return [
      {
        kind: 'grant',
        isGrant: false,
        privileges: privList(revokeMatch[1] ?? ''),
        objects: [parseQualifiedName(revokeMatch[2] ?? '')],
        grantees: roleList(revokeMatch[3] ?? ''),
        ...base,
      },
    ]
  }

  const grantAllMatch =
    /^grant\s+([\s\S]+?)\s+on\s+all\s+tables\s+in\s+schema\s+([\w",\s]+?)\s+to\s+([\s\S]+)$/i.exec(
      stripped,
    )
  if (grantAllMatch) {
    const privText = (grantAllMatch[1] ?? '').toLowerCase()
    return [
      {
        kind: 'grantAllInSchema',
        isGrant: true,
        privileges: /\ball\b/.test(privText)
          ? 'all'
          : privText
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean),
        schemas: (grantAllMatch[2] ?? '')
          .split(',')
          .map((s) => s.trim().replace(/^"|"$/g, ''))
          .filter(Boolean),
        grantees: (grantAllMatch[3] ?? '')
          .replace(/\bwith\s+grant\s+option\b/i, '')
          .split(',')
          .map((r) => r.trim().replace(/^"|"$/g, ''))
          .filter(Boolean),
        ...base,
      },
    ]
  }

  const grantMatch =
    /^grant\s+([\s\S]+?)\s+on\s+(?:table\s+)?("?[\w".]+"?)\s+to\s+([\s\S]+)$/i.exec(stripped)
  if (grantMatch) {
    const privText = (grantMatch[1] ?? '').toLowerCase()
    const privileges: string[] | 'all' = /\ball\b/.test(privText)
      ? 'all'
      : privText
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
    const grantees = (grantMatch[3] ?? '')
      .replace(/\bwith\s+grant\s+option\b/i, '')
      .split(',')
      .map((r) => r.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
    return [
      {
        kind: 'grant',
        isGrant: true,
        privileges,
        objects: [parseQualifiedName(grantMatch[2] ?? '')],
        grantees,
        ...base,
      },
    ]
  }

  const viewMatch =
    /^create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?view\s+("?[\w".]+"?)/i.exec(stripped)
  if (viewMatch) {
    const ref = parseQualifiedName(viewMatch[1] ?? '')
    const asIndex = stripped.search(/\bas\b/i)
    const header = stripped.slice(0, asIndex >= 0 ? asIndex : undefined)
    const securityInvoker = /security_invoker\s*=\s*(on|true|1)/i.test(header)
    return [
      {
        kind: 'createView',
        schema: ref.schema,
        name: ref.name,
        securityInvoker,
        referencesAuthUsers: /\bauth\.users\b/i.test(stripped),
        ...base,
      },
    ]
  }

  const materializedViewMatch =
    /^create\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?("?[\w".]+"?)/i.exec(stripped)
  if (materializedViewMatch) {
    const ref = parseQualifiedName(materializedViewMatch[1] ?? '')
    return [
      {
        kind: 'createMaterializedView',
        schema: ref.schema,
        name: ref.name,
        ...base,
      },
    ]
  }

  const foreignTableMatch =
    /^create\s+foreign\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w".]+"?)/i.exec(stripped)
  if (foreignTableMatch) {
    const ref = parseQualifiedName(foreignTableMatch[1] ?? '')
    return [
      {
        kind: 'createForeignTable',
        schema: ref.schema,
        name: ref.name,
        ...base,
      },
    ]
  }

  const funcMatch = /^create\s+(?:or\s+replace\s+)?function\s+("?[\w".]+"?)/i.exec(stripped)
  if (funcMatch) {
    const ref = parseQualifiedName((funcMatch[1] ?? '').replace(/\(.*$/, ''))
    return [
      {
        kind: 'createFunction',
        schema: ref.schema,
        name: ref.name,
        hasSearchPath: /\bset\s+search_path\b/i.test(stripped),
        securityDefiner: /\bsecurity\s+definer\b/i.test(stripped),
        ...base,
      },
    ]
  }

  const schemaMatch = /^create\s+schema\s+(?:if\s+not\s+exists\s+)?("?[\w]+"?)/i.exec(stripped)
  if (schemaMatch) {
    return [{ kind: 'createSchema', name: (schemaMatch[1] ?? '').replace(/^"|"$/g, ''), ...base }]
  }

  const dropTableMatch = /^drop\s+table\s+(?:if\s+exists\s+)?("?[\w".]+"?)/i.exec(stripped)
  if (dropTableMatch) {
    const ref = parseQualifiedName(dropTableMatch[1] ?? '')
    return [{ kind: 'dropTable', schema: ref.schema, name: ref.name, ...base }]
  }

  const dropMaterializedViewMatch =
    /^drop\s+materialized\s+view\s+(?:if\s+exists\s+)?("?[\w".]+"?)/i.exec(stripped)
  if (dropMaterializedViewMatch) {
    const ref = parseQualifiedName(dropMaterializedViewMatch[1] ?? '')
    return [{ kind: 'dropMaterializedView', schema: ref.schema, name: ref.name, ...base }]
  }

  const dropForeignTableMatch = /^drop\s+foreign\s+table\s+(?:if\s+exists\s+)?("?[\w".]+"?)/i.exec(
    stripped,
  )
  if (dropForeignTableMatch) {
    const ref = parseQualifiedName(dropForeignTableMatch[1] ?? '')
    return [{ kind: 'dropForeignTable', schema: ref.schema, name: ref.name, ...base }]
  }

  const dropViewMatch = /^drop\s+view\s+(?:if\s+exists\s+)?("?[\w".]+"?)/i.exec(stripped)
  if (dropViewMatch) {
    const ref = parseQualifiedName(dropViewMatch[1] ?? '')
    return [{ kind: 'dropView', schema: ref.schema, name: ref.name, ...base }]
  }

  const dropFunctionMatch = /^drop\s+function\s+(?:if\s+exists\s+)?("?[\w".]+"?)/i.exec(stripped)
  if (dropFunctionMatch) {
    const ref = parseQualifiedName((dropFunctionMatch[1] ?? '').replace(/\(.*$/, ''))
    return [{ kind: 'dropFunction', schema: ref.schema, name: ref.name, ...base }]
  }

  return [{ kind: 'other', ...base }]
}

export const regexBackend: ParserBackend = {
  name: 'regex',
  async parse(content: string, file: string): Promise<ParseResult> {
    const index = new LineIndex(content)
    const statements: Statement[] = []
    for (const raw of splitStatements(content)) {
      const { line, column } = index.locate(raw.offset)
      const loc: SourceLocation = { file, line, column, offset: raw.offset }
      statements.push(...normalize(raw.text, loc))
    }
    return { statements, backend: 'regex', errors: [] }
  },
}
