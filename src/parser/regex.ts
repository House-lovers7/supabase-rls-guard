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

function authFnsFromText(clause: string | undefined, acc: AuthFnRef[]): void {
  if (!clause) return
  const lower = clause.toLowerCase()
  for (const fn of AUTH_FUNCTIONS) {
    let from = 0
    for (;;) {
      const idx = lower.indexOf(fn, from)
      if (idx === -1) break
      const wrapped = /\(\s*select\b/i.test(clause.slice(0, idx))
      acc.push({ name: fn, wrapped })
      from = idx + fn.length
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
