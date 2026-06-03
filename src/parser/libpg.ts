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
import type {
  AuthFnRef,
  ColumnInfo,
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

function normalizePolicy(inner: unknown, loc: SourceLocation): PolicyInfo {
  const table = rangeVar(field(inner, 'table'))
  const qual = field(inner, 'qual')
  const withCheck = field(inner, 'with_check')
  const authFns: AuthFnRef[] = []
  collectAuthFns(qual, false, authFns)
  collectAuthFns(withCheck, false, authFns)
  const exprBlob = `${stripLocations(qual ?? null)}${stripLocations(withCheck ?? null)}`
  return {
    name: asString(field(inner, 'policy_name')) ?? '(unnamed)',
    schema: table.schema,
    table: table.name,
    command: (asString(field(inner, 'cmd_name')) ?? 'all') as PolicyCommand,
    roles: asArray(field(inner, 'roles')).map(roleName),
    permissive: field(inner, 'permissive') === true,
    hasUsing: qual !== undefined,
    hasCheck: withCheck !== undefined,
    usingAlwaysTrue: qual !== undefined ? isAlwaysTrue(qual) : false,
    checkAlwaysTrue: withCheck !== undefined ? isAlwaysTrue(withCheck) : false,
    authFns,
    referencesUserMetadata: USER_METADATA_RE.test(exprBlob),
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
        const action = RLS_SUBTYPES[asString(field(field(cmd, 'AlterTableCmd'), 'subtype')) ?? '']
        if (action)
          cmds.push({ kind: 'alterRls', schema: rel.schema, name: rel.name, action, ...base })
      }
      return cmds.length > 0 ? cmds : [{ kind: 'other', ...base }]
    }
    case 'CreatePolicyStmt':
      return [{ kind: 'createPolicy', policy: normalizePolicy(inner, loc), ...base }]
    case 'GrantStmt': {
      if (
        asString(field(inner, 'objtype')) !== 'OBJECT_TABLE' ||
        asString(field(inner, 'targtype')) !== 'ACL_TARGET_OBJECT'
      ) {
        return [{ kind: 'other', ...base }]
      }
      const privList = field(inner, 'privileges')
      const privileges: string[] | 'all' =
        privList === undefined
          ? 'all'
          : asArray(privList)
              .map((p) => asString(field(field(p, 'AccessPriv'), 'priv_name')))
              .filter((p): p is string => p !== undefined)
      return [
        {
          kind: 'grant',
          isGrant: field(inner, 'is_grant') === true,
          privileges,
          objects: asArray(field(inner, 'objects')).map((o) => rangeVar(field(o, 'RangeVar'))),
          grantees: asArray(field(inner, 'grantees')).map(roleName),
          ...base,
        },
      ]
    }
    case 'ViewStmt': {
      const rel = rangeVar(field(inner, 'view'))
      return [
        {
          kind: 'createView',
          schema: rel.schema,
          name: rel.name,
          securityInvoker: viewSecurityInvoker(asArray(field(inner, 'options'))),
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
      return [{ kind: 'other', ...base }]
    }
    default:
      return [{ kind: 'other', ...base }]
  }
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

    rawStmts.forEach((rawStmt, i) => {
      const node = field(rawStmt, 'stmt')
      if (node === undefined) return
      const rawStart = asNumber(field(rawStmt, 'stmt_location')) ?? 0
      const len = asNumber(field(rawStmt, 'stmt_len'))
      const end =
        len !== undefined
          ? rawStart + len
          : (asNumber(field(rawStmts[i + 1], 'stmt_location')) ?? content.length)
      // libpg points at the char after the previous `;`; skip trivia to the real token.
      const offset = skipLeadingTrivia(content, rawStart, end)
      const { line, column } = index.locate(offset)
      const loc: SourceLocation = { file, line, column, offset }
      statements.push(...normalizeStatement(node, loc, content.slice(offset, end).trim()))
    })

    return { statements, backend: 'libpg', errors }
  },
}
