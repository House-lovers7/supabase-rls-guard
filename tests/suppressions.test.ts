import { describe, expect, it } from 'vitest'
import { isSuppressed, parseSuppressions } from '../src/config/suppressions.js'
import { parseUserConfig } from '../src/config/validate.js'

describe('parseSuppressions', () => {
  it('suppresses a specific rule on the next line', () => {
    const sup = parseSuppressions(
      '-- rls-guard-disable-next-line RLS001\ncreate table public.t (id int);',
    )
    expect(isSuppressed(sup, 'RLS001', 2)).toBe(true)
    expect(isSuppressed(sup, 'RLS002', 2)).toBe(false)
  })

  it('suppresses all rules for a file when no id is given', () => {
    const sup = parseSuppressions('-- rls-guard-disable-file\ncreate table public.t (id int);')
    expect(isSuppressed(sup, 'RLS001', 99)).toBe(true)
    expect(isSuppressed(sup, 'RLS010', 1)).toBe(true)
  })

  it('suppresses a finding reported on the same line', () => {
    const sup = parseSuppressions(
      'create table public.t (id int); -- rls-guard-disable-line RLS001',
    )
    expect(isSuppressed(sup, 'RLS001', 1)).toBe(true)
  })

  it('is case-insensitive on rule ids', () => {
    const sup = parseSuppressions('-- rls-guard-disable-file rls004')
    expect(isSuppressed(sup, 'RLS004', 1)).toBe(true)
  })
})

describe('parseUserConfig', () => {
  it('accepts a valid config', () => {
    const { config, warnings } = parseUserConfig({
      exposedSchemas: ['public', 'api'],
      failOn: 'warning',
      disabledRules: ['RLS002'],
      severity: { RLS010: 'warning' },
    })
    expect(warnings).toHaveLength(0)
    expect(config.exposedSchemas).toEqual(['public', 'api'])
    expect(config.failOn).toBe('warning')
  })

  it('drops invalid fields with a warning instead of trusting them', () => {
    const { config, warnings } = parseUserConfig({
      exposedSchemas: 'public',
      failOn: 'nope',
      severity: { RLS010: 'banana' },
    })
    expect(config.exposedSchemas).toBeUndefined()
    expect(config.failOn).toBeUndefined()
    expect(warnings.length).toBeGreaterThanOrEqual(3)
  })

  it('ignores a non-object config', () => {
    const { warnings } = parseUserConfig('not an object')
    expect(warnings).toHaveLength(1)
  })
})
