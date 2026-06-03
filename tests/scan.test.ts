import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scan } from '../src/core/scan.js'
import { render } from '../src/reporters/index.js'

const UNSAFE = 'examples/unsafe-project/supabase/migrations'
const SAFE = 'examples/safe-project/supabase/migrations'

describe('scan integration', () => {
  it('fails on the unsafe example project', async () => {
    const result = await scan({ path: UNSAFE })
    expect(result.summary.failed).toBe(true)
    expect(result.summary.critical).toBeGreaterThan(0)
    expect(result.findings.some((f) => f.ruleId === 'RLS001')).toBe(true)
  })

  it('passes cleanly on the safe example project', async () => {
    const result = await scan({ path: SAFE })
    expect(result.findings).toHaveLength(0)
    expect(result.summary.failed).toBe(false)
  })

  it('does not flag a table whose RLS is enabled in a later migration', async () => {
    const result = await scan({ path: UNSAFE })
    expect(result.findings.some((f) => f.target.startsWith('public.todos'))).toBe(false)
  })

  it('honors inline suppression comments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rlsguard-'))
    try {
      await writeFile(
        join(dir, '001.sql'),
        '-- rls-guard-disable-next-line RLS001\ncreate table public.t (id int);\n',
      )
      const result = await scan({ path: dir })
      expect(result.findings.some((f) => f.ruleId === 'RLS001')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('renders every output format', async () => {
    const result = await scan({ path: UNSAFE })
    expect(render(result, 'text', { color: false })).toContain('RLS001')

    const json = JSON.parse(render(result, 'json'))
    expect(json.summary.total).toBe(result.summary.total)

    const sarif = JSON.parse(render(result, 'sarif'))
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs[0].results).toHaveLength(result.findings.length)

    expect(render(result, 'github')).toContain('::error')
  })

  it('strict mode lowers the gate to warning', async () => {
    const result = await scan({ path: UNSAFE, strict: true })
    expect(result.config.failOn).toBe('warning')
  })
})
