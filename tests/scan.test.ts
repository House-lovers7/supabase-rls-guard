import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scan } from '../src/core/scan.js'
import { render } from '../src/reporters/index.js'

/** Run `fn` with a fresh temp dir, cleaning up afterwards. */
async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'rlsguard-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

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

  it('#29 --strict never weakens a stricter config (failOn: info stays info)', async () => {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, '001.sql'), 'create table public.t (id int);\n')
      await writeFile(join(dir, '.rlsguardrc.json'), '{"failOn":"info"}\n')
      const result = await scan({
        path: dir,
        strict: true,
        cwd: dir,
        configPath: join(dir, '.rlsguardrc.json'),
      })
      expect(result.config.failOn).toBe('info')
    })
  })
})

describe('#20 multibyte input (UTF-8 byte offsets)', () => {
  it('reports correct line numbers after a Japanese comment', async () => {
    await withTmpDir(async (dir) => {
      await writeFile(
        join(dir, '001.sql'),
        '-- これは日本語のコメントです（マイグレーション）\ncreate table public.a (id int);\ncreate table public.b (password text);\n',
      )
      const result = await scan({ path: dir })
      const b = result.findings.find((f) => f.target === 'public.b')
      expect(b?.loc.line).toBe(3)
    })
  })

  it('inline suppressions still work below a multibyte comment', async () => {
    await withTmpDir(async (dir) => {
      await writeFile(
        join(dir, '001.sql'),
        '-- これは日本語のコメントです（マイグレーション）\ncreate table public.a (id int);\n-- rls-guard-disable-next-line RLS001 RLS002 RLS004\ncreate table public.b (password text);\n',
      )
      const result = await scan({ path: dir })
      expect(result.findings.some((f) => f.target.startsWith('public.b'))).toBe(false)
      // the un-suppressed table still fires
      expect(result.findings.some((f) => f.target === 'public.a' && f.ruleId === 'RLS001')).toBe(
        true,
      )
    })
  })
})

describe('#28/#31 discover robustness', () => {
  it('a directory named *.sql does not abort the scan (warning instead)', async () => {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, '001.sql'), 'create table public.t (id int);\n')
      await mkdir(join(dir, 'oops.sql'))
      const result = await scan({ path: dir })
      expect(result.summary.filesScanned).toBe(1)
      expect(result.findings.some((f) => f.ruleId === 'RLS001')).toBe(true)
    })
  })

  it('a broken symlink is skipped with a warning', async () => {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, '001.sql'), 'create table public.t (id int);\n')
      await symlink(join(dir, 'missing-target.sql'), join(dir, '002.sql'))
      const result = await scan({ path: dir })
      expect(result.summary.filesScanned).toBe(1)
      expect(result.warnings.some((w) => w.includes('002.sql'))).toBe(true)
    })
  })

  it('a symlink loop does not duplicate files', async () => {
    await withTmpDir(async (dir) => {
      const mig = join(dir, 'migrations')
      await mkdir(mig)
      await writeFile(join(mig, '001.sql'), 'create table public.t (id int);\n')
      await symlink(mig, join(mig, 'loop'))
      const result = await scan({ path: mig })
      expect(result.summary.filesScanned).toBe(1)
    })
  })
})

describe('#30 deterministic byte ordering', () => {
  it('applies B.sql before a.sql (codepoint order), matching migration runners', async () => {
    await withTmpDir(async (dir) => {
      // Byte order: B(0x42) < a(0x61) → create+disable runs first, enable+policy second.
      await writeFile(
        join(dir, 'B.sql'),
        'create table public.t (id uuid, user_id uuid); alter table public.t disable row level security;\n',
      )
      await writeFile(
        join(dir, 'a.sql'),
        'alter table public.t enable row level security; create policy p on public.t for select to authenticated using ((select auth.uid()) = user_id);\n',
      )
      const result = await scan({ path: dir })
      // Final state must be RLS-enabled → no RLS001/RLS003.
      expect(result.findings.some((f) => f.ruleId === 'RLS001')).toBe(false)
      expect(result.findings.some((f) => f.ruleId === 'RLS003')).toBe(false)
    })
  })
})

describe('#33 paths outside cwd', () => {
  it('emits scan-root-relative paths (no ".." segments) for out-of-cwd scans', async () => {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, '001.sql'), 'create table public.t (id int);\n')
      const result = await scan({ path: dir }) // tmpdir is outside the repo cwd
      for (const f of result.findings) {
        expect(f.loc.file.startsWith('..')).toBe(false)
      }
    })
  })
})
