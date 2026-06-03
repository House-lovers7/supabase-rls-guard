import type { Finding, ResolvedConfig, Severity, SourceLocation } from '../core/types.js'

export const SUPABASE_RLS_DOCS =
  'https://supabase.com/docs/guides/database/postgres/row-level-security'

export function splinterDocs(slug: string): string {
  return `https://supabase.github.io/splinter/${slug}/`
}

/** True when a table is explicitly allowlisted as intentionally public. */
export function isAllowlisted(config: ResolvedConfig, schema: string, name: string): boolean {
  const qualified = `${schema}.${name}`.toLowerCase()
  const bare = name.toLowerCase()
  return config.publicTables.some((entry) => {
    const e = entry.toLowerCase()
    return e === qualified || e === bare
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
