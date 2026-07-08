import type { Finding, ResolvedConfig, Severity, SourceLocation } from '../core/types.js'

export const SUPABASE_RLS_DOCS =
  'https://supabase.com/docs/guides/database/postgres/row-level-security'

export function splinterDocs(slug: string): string {
  return `https://supabase.github.io/splinter/${slug}/`
}

/**
 * True when a table is explicitly allowlisted as intentionally public.
 *
 * Unqualified entries (e.g. `"blog_posts"`) are only honored for tables in the
 * `public` schema — not for same-named tables in other schemas (e.g.
 * `private.blog_posts`). Without this restriction, a config author who wrote
 * an unqualified `publicTables` entry could silently suppress findings for an
 * unrelated table in a different, non-public schema.
 */
export function isAllowlisted(config: ResolvedConfig, schema: string, name: string): boolean {
  const qualified = `${schema}.${name}`.toLowerCase()
  const bare = name.toLowerCase()
  const isPublicSchema = schema.toLowerCase() === 'public'
  return config.publicTables.some((entry) => {
    const e = entry.toLowerCase()
    return e === qualified || (isPublicSchema && e === bare)
  })
}

export interface FindingInput {
  ruleId: string
  ruleName: string
  severity: Severity
  message: string
  target: string
  loc: SourceLocation
  fix?: string
  docs?: string
}

export function finding(input: FindingInput): Finding {
  return { ...input }
}
