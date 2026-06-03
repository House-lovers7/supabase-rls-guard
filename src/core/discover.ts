import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

export interface MigrationFile {
  /** Absolute path on disk. */
  abs: string
  /** Path relative to cwd, POSIX-normalized (used in messages / SARIF). */
  rel: string
  content: string
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/')
}

async function findSqlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true })
  return entries
    .filter((e) => e.endsWith('.sql') && !e.split(sep).includes('node_modules'))
    .map((e) => join(dir, e))
}

/**
 * Resolve the set of migration `.sql` files to scan, sorted in application order.
 *
 * Accepts a single `.sql` file, a migrations directory, or a project root (in
 * which case `supabase/migrations` is auto-detected). Files are sorted by
 * basename so the `YYYYMMDDHHmmss_` timestamp prefix drives ordering.
 */
export async function discover(inputPath: string): Promise<MigrationFile[]> {
  const abs = resolve(inputPath)
  if (!existsSync(abs)) {
    throw new Error(`Path not found: ${inputPath}`)
  }

  const info = await stat(abs)
  let files: string[]

  if (info.isFile()) {
    files = abs.endsWith('.sql') ? [abs] : []
  } else {
    const nested = join(abs, 'supabase', 'migrations')
    const root = existsSync(nested) ? nested : abs
    files = await findSqlFiles(root)
  }

  files.sort((a, b) => {
    const cmp = basename(a).localeCompare(basename(b))
    return cmp !== 0 ? cmp : a.localeCompare(b)
  })

  const cwd = process.cwd()
  return Promise.all(
    files.map(async (file) => ({
      abs: file,
      rel: toPosix(relative(cwd, file)) || basename(file),
      content: await readFile(file, 'utf8'),
    })),
  )
}
