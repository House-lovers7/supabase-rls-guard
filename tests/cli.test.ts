/**
 * End-to-end CLI tests that spawn the built binary (dist/cli.mjs).
 *
 * Skipped automatically when dist/ has not been built yet (CI runs tests before
 * build); locally run `pnpm build` first to include them.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = resolve('dist/cli.mjs')
const SAFE = 'examples/safe-project/supabase/migrations'
const UNSAFE = 'examples/unsafe-project/supabase/migrations'

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe.skipIf(!existsSync(CLI))('CLI (built binary)', () => {
  it('exit 0 on the safe example, 1 on the unsafe example', () => {
    expect(run([SAFE]).status).toBe(0)
    expect(run([UNSAFE]).status).toBe(1)
  })

  it('#32 invalid flag values exit 2 (documented tool-error code)', () => {
    expect(run(['--format', 'bogus', SAFE]).status).toBe(2)
    expect(run(['--backend', 'bogus', SAFE]).status).toBe(2)
    expect(run(['--fail-on', 'bogus', SAFE]).status).toBe(2)
  })

  it('#34 zero .sql files exit 2 even with --quiet; --allow-empty exits 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rlsguard-empty-'))
    try {
      await mkdir(join(dir, 'sub'))
      const failed = run([dir, '--quiet'])
      expect(failed.status).toBe(2)
      expect(failed.stderr).toContain('no .sql files')
      expect(run([dir, '--allow-empty']).status).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('#19 large piped output is not truncated at 64 KiB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rlsguard-big-'))
    try {
      // ~300 unprotected tables with sensitive columns → SARIF well over 64 KiB.
      const tables: string[] = []
      for (let i = 0; i < 300; i++) {
        tables.push(
          `create table public.t${i} (id uuid primary key, password text, access_token text);`,
        )
      }
      await writeFile(join(dir, '001.sql'), tables.join('\n'))
      // spawnSync captures stdout through a PIPE — exactly the truncation scenario.
      const r = run([dir, '--format', 'sarif', '--quiet'])
      expect(r.status).toBe(1)
      expect(Buffer.byteLength(r.stdout)).toBeGreaterThan(65536)
      const sarif = JSON.parse(r.stdout) // must be complete, valid JSON
      expect(sarif.version).toBe('2.1.0')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30000)
})
