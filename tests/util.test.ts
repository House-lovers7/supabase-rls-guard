import { describe, expect, it } from 'vitest'
import { baseConfig } from '../src/config/defaults.js'
import type { ResolvedConfig } from '../src/core/types.js'
import { isAllowlisted } from '../src/rules/util.js'

function withPublicTables(publicTables: string[]): ResolvedConfig {
  return { ...baseConfig(), publicTables }
}

describe('isAllowlisted', () => {
  it('matches a qualified entry against the same schema.table', () => {
    const config = withPublicTables(['public.blog_posts'])
    expect(isAllowlisted(config, 'public', 'blog_posts')).toBe(true)
  })

  it('does not let a qualified entry leak into another schema', () => {
    const config = withPublicTables(['public.blog_posts'])
    expect(isAllowlisted(config, 'private', 'blog_posts')).toBe(false)
  })

  it('lets an unqualified entry match the public schema (back-compat)', () => {
    const config = withPublicTables(['blog_posts'])
    expect(isAllowlisted(config, 'public', 'blog_posts')).toBe(true)
  })

  it('does not let an unqualified entry match a same-named table in another schema', () => {
    const config = withPublicTables(['blog_posts'])
    expect(isAllowlisted(config, 'private', 'blog_posts')).toBe(false)
    expect(isAllowlisted(config, 'admin', 'blog_posts')).toBe(false)
  })

  it('is case-insensitive for both schema-qualified and bare entries', () => {
    const config = withPublicTables(['Public.Blog_Posts'])
    expect(isAllowlisted(config, 'PUBLIC', 'blog_posts')).toBe(true)
  })
})
