/**
 * Primary parser backend, built on `libpg-query` — the actual PostgreSQL grammar
 * compiled to WASM. It produces an exact parse tree, so dollar-quoted function
 * bodies, comments, and string literals never confuse statement detection.
 *
 * The parse tree is untyped external data, so we navigate it via the `unknown`
 * guards in {@link ./ast} and emit the small, fully-typed {@link Statement}
 * model the rest of the tool consumes — i.e. this module is the parse/validate
 * boundary that turns `unknown` into typed values.
 */

import { LineIndex, skipLeadingTrivia } from '../core/location.js'
import { aggregateExprs, EMPTY_EXPR } from '../core/policy.js'
import type {
  AuthFnRef,
  ColumnInfo,
  ExprInfo,
  PolicyCommand,
  PolicyInfo,
  SourceLocation,
  Statement,
  TableRef,
} from '../core/types.js'
import {
  asArray,
  asNumber,
  asObject,
  asString,
  field,
  isTrue,
  nodeTag,
  stringValues,
} from './ast.js'
import {
  AUTH_FUNCTIONS,
  type ParseError,
  type ParseResult,
  type ParserBackend,
  USER_METADATA_RE,
} from './backend.js'

function rangeVar(rv: unknown): TableRef {
  return {
    schema: asString(field(rv, 'schemaname')) ?? 'public',
    name: asString(field(rv, 'relname')) ?? '',
  }
}

function typeName(tn: unknown): string {
  const names = stringValues(field(tn, 'names')).filter((n) => n !== 'pg_catalog')
  return names.join('.') || 'unknown'
}

function roleName(roleSpec: unknown): string {
  const rs = field(roleSpec, 'RoleSpec') ?? roleSpec
  switch (asString(field(rs, 'roletype'))) {
    case 'ROLESPEC_PUBLIC':
      return 'public'
    case 'ROLESPEC_CURRENT_USER':
      return 'current_user'
    case 'ROLESPEC_SESSION_USER':
      return 'session_user'
    default:
      return asString(field(rs, 'rolename')) ?? 'public'
  }
}

function opName(nameList: unknown): string | undefined {
  return asString(field(field(asArray(nameList)[0], 'String'), 'sval'))
}

function stripLocations(node: unknown): string {
  return JSON.stringify(node, (key, value) => (key === 'location' ? undefined : value))
}

/** True for expressions that always pass: `true`, `1 = 1`, `'x' = 'x'`, with TypeCast unwrapping. */
function isAlwaysTrue(node: unknown): boolean {
  // A_Const -> boolval -> boolval === true   ( i.e. the literal `true` )
  if (isTrue(field(field(field(node, 'A_Const'), 'boolval'), 'boolval'))) return true
  const typeCast = field(node, 'TypeCast')
  if (typeCast !== undefined) return isAlwaysTrue(field(typeCast, 'arg'))
  const aExpr = field(node, 'A_Expr')
  if (aExpr !== undefined && opName(field(aExpr, 'name')) === '=') {
    const lexpr = field(aExpr, 'lexpr')
    const rexpr = field(aExpr, 'rexpr')
    if (
      lexpr !== undefined &&
      rexpr !== undefined &&
      stripLocations(lexpr) === stripLocations(rexpr)
    ) {
      return true
    }
  }
  return false
}

function funcName(funcnameList: unknown): string {
  return stringValues(funcnameList).join('.')
}

/** True when a subtree contains a RangeVar referencing `auth.users` (RLS015). */
function selectsFromAuthUsers(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(selectsFromAuthUsers)
  const obj = asObject(node)
  if (!obj) return false
  const rv = field(obj, 'RangeVar')
  if (
    rv &&
    asString(field(rv, 'schemaname')) === 'auth' &&
    asString(field(rv, 'relname')) === 'users'
  ) {
    return true
  }
  return Object.values(obj).some(selectsFromAuthUsers)
}

/** Collects auth/setting function calls, tracking whether each is wrapped in a subquery. */
function collectAuthFns(node: unknown, insideSubLink: boolean, acc: AuthFnRef[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectAuthFns(item, insideSubLink, acc)
    return
  }
  const obj = asObject(node)
  if (!obj) return
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'FuncCall') {
      const name = funcName(field(value, 'funcname'))
      if (AUTH_FUNCTIONS.has(name)) acc.push({ name, wrapped: insideSubLink })
    }
    collectAuthFns(value, insideSubLink || key === 'SubLink', acc)
  }
}

/** Describes a single policy expression node (a `USING` or `WITH CHECK` clause). */
function describeExpr(node: unknown): ExprInfo {
  if (node === undefined) return EMPTY_EXPR
  const authFns: AuthFnRef[] = []
  collectAuthFns(node, false, authFns)
  return {
    present: true,
    alwaysTrue: isAlwaysTrue(node),
    authFns,
    referencesUserMetadata: USER_METADATA_RE.test(stripLocations(node)),
  }
}

function normalizePolicy(inner: unknown, loc: SourceLocation): PolicyInfo {
  const table = rangeVar(field(inner, 'table'))
  const usingExpr = describeExpr(field(inner, 'qual'))
  const checkExpr = describeExpr(field(inner, 'with_check'))
  return {
    name: asString(field(inner, 'policy_name')) ?? '(unnamed)',
    schema: table.schema,
    table: table.name,
    command: (asString(field(inner, 'cmd_name')) ?? 'all') as PolicyCommand,
    roles: asArray(field(inner, 'roles')).map(roleName),
    permissive: field(inner, 'permissive') === true,
    usingExpr,
    checkExpr,
    ...aggregateExprs(usingExpr, checkExpr),
    loc,
  }
}

function columns(tableElts: unknown): ColumnInfo[] {
  return asArray(tableElts).flatMap((elt): ColumnInfo[] => {
    const cd = field(elt, 'ColumnDef')
    const name = asString(field(cd, 'colname'))
    if (!name) return []
    return [{ name, type: typeName(field(cd, 'typeName')) }]
  })
}

const RLS_SUBTYPES: Record<string, 'enable' | 'disable' | 'force' | 'noforce'> = {
  AT_EnableRowSecurity: 'enable',
  AT_DisableRowSecurity: 'disable',
  AT_ForceRowSecurity: 'force',
  AT_NoForceRowSecurity: 'noforce',
}

function hasSearchPathOption(options: unknown[]): boolean {
  return options.some((o) => {
    const de = field(o, 'DefElem')
    if (asString(field(de, 'defname')) !== 'set') return false
    return asString(field(field(field(de, 'arg'), 'VariableSetStmt'), 'name')) === 'search_path'
  })
}

function isSecurityDefiner(options: unknown[]): boolean {
  return options.some((o) => {
    const de = field(o, 'DefElem')
    if (asString(field(de, 'defname')) !== 'security') return false
    return isTrue(field(field(field(de, 'arg'), 'Boolean'), 'boolval'))
  })
}

function viewSecurityInvoker(options: unknown[]): boolean {
  return options.some((o) => {
    const de = field(o, 'DefElem')
    if (asString(field(de, 'defname')) !== 'security_invoker') return false
    const arg = field(de, 'arg')
    return (
      isTrue(field(field(arg, 'Boolean'), 'boolval')) ||
      ['on', 'true', '1'].includes(asString(field(field(arg, 'String'), 'sval')) ?? '')
    )
  })
}

function normalizeStatement(node: unknown, loc: SourceLocation, raw: string): Statement[] {
  const tag = nodeTag(node)
  if (!tag) return [{ kind: 'other', loc, raw }]
  const inner = field(node, tag)
  const base = { loc, raw }

  switch (tag) {
    case 'CreateStmt': {
      const rel = rangeVar(field(inner, 'relation'))
      return [
        {
          kind: 'createTable',
          schema: rel.schema,
          name: rel.name,
          ifNotExists: field(inner, 'if_not_exists') === true,
          columns: columns(field(inner, 'tableElts')),
          ...base,
        },
      ]
    }
    case 'CreateTableAsStmt': {
      const rel = rangeVar(field(field(inner, 'into'), 'rel'))
      return [
        {
          kind: 'createTable',
          schema: rel.schema,
          name: rel.name,
          ifNotExists: false,
          columns: [],
          ...base,
        },
      ]
    }
    case 'AlterTableStmt': {
      const rel = rangeVar(field(inner, 'relation'))
      const cmds: Statement[] = []
      for (const cmd of asArray(field(inner, 'cmds'))) {
        const alterCmd = field(cmd, 'AlterTableCmd')
        const subtype = asString(field(alterCmd, 'subtype'))
        const action = RLS_SUBTYPES[subtype ?? '']
        if (action) {
          cmds.push({ kind: 'alterRls', schema: rel.schema, name: rel.name, action, ...base })
        } else if (subtype === 'AT_AddColumn') {
          const cd = field(field(alterCmd, 'def'), 'ColumnDef')
          const colname = asString(field(cd, 'colname'))
          if (colname) {
            cmds.push({
              kind: 'alterTableAddColumn',
              schema: rel.schema,
              name: rel.name,
              column: { name: colname, type: typeName(field(cd, 'typeName')) },
              ...base,
            })
          }
        }
      }
      return cmds.length > 0 ? cmds : [{ kind: 'other', ...base }]
    }
    case 'CreatePolicyStmt':
      return [{ kind: 'createPolicy', policy: normalizePolicy(inner, loc), ...base }]
    case 'AlterPolicyStmt': {
      const table = rangeVar(field(inner, 'table'))
      const rolesNode = field(inner, 'roles')
      const qual = field(inner, 'qual')
      const withCheck = field(inner, 'with_check')
      return [
        {
          kind: 'alterPolicy',
          schema: table.schema,
          table: table.name,
          name: asString(field(inner, 'policy_name')) ?? '(unnamed)',
          roles: rolesNode !== undefined ? asArray(rolesNode).map(roleName) : undefined,
          usingExpr: qual !== undefined ? describeExpr(qual) : undefined,
          checkExpr: withCheck !== undefined ? describeExpr(withCheck) : undefined,
          ...base,
        },
      ]
    }
    case 'GrantStmt': {
      if (asString(field(inner, 'objtype')) !== 'OBJECT_TABLE') {
        return [{ kind: 'other', ...base }]
      }
      const targtype = asString(field(inner, 'targtype'))
      const privList = field(inner, 'privileges')
      const privileges: string[] | 'all' =
        privList === undefined
          ? 'all'
          : asArray(privList)
              .map((p) => asString(field(field(p, 'AccessPriv'), 'priv_name')))
              .filter((p): p is string => p !== undefined)
      const isGrant = field(inner, 'is_grant') === true
      const grantees = asArray(field(inner, 'grantees')).map(roleName)

      // `REVOKE GRANT OPTION FOR ...` removes only the ability to re-grant; the
      // underlying privilege survives — do not subtract the grant from the fold.
      if (!isGrant && isTrue(field(inner, 'grant_option'))) {
        return [{ kind: 'other', ...base }]
      }

      if (targtype === 'ACL_TARGET_OBJECT') {
        return [
          {
            kind: 'grant',
            isGrant,
            privileges,
            objects: asArray(field(inner, 'objects')).map((o) => rangeVar(field(o, 'RangeVar'))),
            grantees,
            ...base,
          },
        ]
      }
      if (targtype === 'ACL_TARGET_ALL_IN_SCHEMA') {
        // `objects` here are schema-name Strings, not RangeVars.
        return [
          {
            kind: 'grantAllInSchema',
            isGrant,
            privileges,
            schemas: stringValues(field(inner, 'objects')),
            grantees,
            ...base,
          },
        ]
      }
      return [{ kind: 'other', ...base }]
    }
    case 'ViewStmt': {
      const rel = rangeVar(field(inner, 'view'))
      return [
        {
          kind: 'createView',
          schema: rel.schema,
          name: rel.name,
          securityInvoker: viewSecurityInvoker(asArray(field(inner, 'options'))),
          referencesAuthUsers: selectsFromAuthUsers(field(inner, 'query')),
          ...base,
        },
      ]
    }
    case 'CreateFunctionStmt': {
      const names = stringValues(field(inner, 'funcname'))
      const options = asArray(field(inner, 'options'))
      return [
        {
          kind: 'createFunction',
          schema: names.length > 1 ? names[0]! : 'public',
          name: names.at(-1) ?? '',
          hasSearchPath: hasSearchPathOption(options),
          securityDefiner: isSecurityDefiner(options),
          ...base,
        },
      ]
    }
    case 'CreateSchemaStmt':
      return [{ kind: 'createSchema', name: asString(field(inner, 'schemaname')) ?? '', ...base }]
    case 'DropStmt': {
      const objects = asArray(field(inner, 'objects'))
      const removeType = asString(field(inner, 'removeType'))
      if (removeType === 'OBJECT_TABLE') {
        return objects.map((o) => {
          const items = stringValues(field(field(o, 'List'), 'items'))
          const [schema, name] = items.length >= 2 ? items : ['public', items[0] ?? '']
          return { kind: 'dropTable' as const, schema: schema!, name: name!, ...base }
        })
      }
      if (removeType === 'OBJECT_POLICY') {
        const items = stringValues(field(field(objects[0], 'List'), 'items'))
        return [
          {
            kind: 'dropPolicy',
            schema: items.length >= 3 ? items[0]! : 'public',
            table: items.at(-2) ?? '',
            name: items.at(-1) ?? '',
            ...base,
          },
        ]
      }
      if (removeType === 'OBJECT_VIEW' || removeType === 'OBJECT_MATVIEW') {
        return objects.map((o) => {
          const items = stringValues(field(field(o, 'List'), 'items'))
          const [schema, name] = items.length >= 2 ? items : ['public', items[0] ?? '']
          return { kind: 'dropView' as const, schema: schema!, name: name!, ...base }
        })
      }
      if (removeType === 'OBJECT_FUNCTION') {
        // objects are ObjectWithArgs nodes: { objname: [String...], objargs: ... }
        return objects.map((o) => {
          const items = stringValues(field(field(o, 'ObjectWithArgs'), 'objname'))
          const [schema, name] = items.length >= 2 ? items : ['public', items[0] ?? '']
          return { kind: 'dropFunction' as const, schema: schema!, name: name!, ...base }
        })
      }
      return [{ kind: 'other', ...base }]
    }
    case 'AlterDefaultPrivilegesStmt': {
      // { options: [DefElem{defname:'schemas', arg:{List of String}}], action: <GrantStmt fields> }
      const action = field(inner, 'action')
      const actionInner = field(action, 'GrantStmt') ?? action
      if (asString(field(actionInner, 'objtype')) !== 'OBJECT_TABLE') {
        return [{ kind: 'other', ...base }]
      }
      const schemas = asArray(field(inner, 'options')).flatMap((o) => {
        const de = field(o, 'DefElem')
        if (asString(field(de, 'defname')) !== 'schemas') return []
        const arg = field(de, 'arg')
        // arg is either a List node ({List:{items:[...]}}) or a bare array of String nodes
        return stringValues(field(field(arg, 'List'), 'items') ?? arg)
      })
      const privList = field(actionInner, 'privileges')
      const privileges: string[] | 'all' =
        privList === undefined
          ? 'all'
          : asArray(privList)
              .map((p) => asString(field(field(p, 'AccessPriv'), 'priv_name')))
              .filter((p): p is string => p !== undefined)
      return [
        {
          kind: 'alterDefaultPrivileges',
          isGrant: field(actionInner, 'is_grant') === true,
          privileges,
          schemas,
          grantees: asArray(field(actionInner, 'grantees')).map(roleName),
          ...base,
        },
      ]
    }
    default:
      return [{ kind: 'other', ...base }]
  }
}

/**
 * libpg-query reports `stmt_location`/`stmt_len` as UTF-8 BYTE offsets (the WASM
 * wrapper marshals the JS string to UTF-8), but JS string APIs index UTF-16 code
 * units. Returns a converter from byte offset → string index. Pure-ASCII content
 * (the common case) short-circuits to the identity function.
 */
function makeByteToCharConverter(content: string): (byteOffset: number) => number {
  const byteLength = Buffer.byteLength(content, 'utf8')
  if (byteLength === content.length) return (b) => b // ASCII fast path

  const byteToChar = new Uint32Array(byteLength + 1)
  let byte = 0
  let i = 0
  while (i < content.length) {
    const cp = content.codePointAt(i) as number
    const charLen = cp > 0xffff ? 2 : 1
    const utf8Len = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4
    byteToChar.fill(i, byte, byte + utf8Len)
    byte += utf8Len
    i += charLen
  }
  byteToChar[byteLength] = content.length
  return (b) => byteToChar[Math.max(0, Math.min(b, byteLength))] as number
}

type ParseFn = (sql: string) => Promise<unknown>
let parseFnPromise: Promise<ParseFn> | undefined

async function getParseFn(): Promise<ParseFn> {
  if (!parseFnPromise) {
    parseFnPromise = import('libpg-query').then((m) => m.parse as ParseFn)
  }
  return parseFnPromise
}

export const libpgBackend: ParserBackend = {
  name: 'libpg',
  async parse(content: string, file: string): Promise<ParseResult> {
    const errors: ParseError[] = []
    const parse = await getParseFn()
    const tree = await parse(content)
    const index = new LineIndex(content)
    const statements: Statement[] = []
    const rawStmts = asArray(field(tree, 'stmts'))

    const byteToChar = makeByteToCharConverter(content)

    rawStmts.forEach((rawStmt, i) => {
      const node = field(rawStmt, 'stmt')
      if (node === undefined) return
      // stmt_location/stmt_len are UTF-8 byte offsets — convert to string indexes.
      const byteStart = asNumber(field(rawStmt, 'stmt_location')) ?? 0
      const byteLen = asNumber(field(rawStmt, 'stmt_len'))
      const rawStart = byteToChar(byteStart)
      const end =
        byteLen !== undefined
          ? byteToChar(byteStart + byteLen)
          : (() => {
              const nextByte = asNumber(field(rawStmts[i + 1], 'stmt_location'))
              return nextByte !== undefined ? byteToChar(nextByte) : content.length
            })()
      // libpg points at the char after the previous `;`; skip trivia to the real token.
      const offset = skipLeadingTrivia(content, rawStart, end)
      const { line, column } = index.locate(offset)
      const loc: SourceLocation = { file, line, column, offset }
      statements.push(...normalizeStatement(node, loc, content.slice(offset, end).trim()))
    })

    return { statements, backend: 'libpg', errors }
  },
}
