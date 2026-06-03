import type { Statement } from '../core/types.js'

export interface ParseError {
  message: string
  file: string
  line?: number
}

export interface ParseResult {
  statements: Statement[]
  backend: 'libpg' | 'regex'
  errors: ParseError[]
}

export interface ParserBackend {
  readonly name: 'libpg' | 'regex'
  parse(content: string, file: string): Promise<ParseResult>
}

/** The set of `auth.*` / settings functions whose unwrapped use is a perf footgun (RLS008). */
export const AUTH_FUNCTIONS = new Set(['auth.uid', 'auth.jwt', 'auth.role', 'current_setting'])

/** Matches columns that user code can edit and must never be trusted for authz (RLS009). */
export const USER_METADATA_RE = /\b(?:raw_user_meta_data|user_metadata)\b/i
