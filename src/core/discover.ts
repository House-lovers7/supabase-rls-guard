import { existsSync } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export interface MigrationFile {
  /** Absolute path on disk. */
  abs: string
  /** Path relative to cwd (or to the scan root when outside cwd), POSIX-normalized. */
  rel: string
  content: string
}

export interface DiscoverResult {
  files: MigrationFile[]
  /** Non-fatal problems (unreadable entries, broken symlinks) — the scan continues. */
  warnings: string[]
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/')
}

/** Deterministic codepoint comparison — matches the byte order migration runners use. */
function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function findSqlFiles(dir: string): Promise<string[]> {
  // withFileTypes-based recursion does NOT follow directory symlinks, which
  // prevents symlink loops; directory entries named `*.sql` are excluded here.
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter(
      (e) =>
        e.name.endsWith('.sql') &&
        !e.isDirectory() &&
        !e.parentPath.split(sep).includes('node_modules'),
    )
    .map((e) => join(e.parentPath, e.name))
}

/**
 * Resolve the set of migration `.sql` files to scan, sorted in application order.
 *
 * Accepts a single `.sql` file, a migrations directory, or a project root (in
 * which case `supabase/migrations` is auto-detected). Files are sorted by
 * basename using plain codepoint order, so the `YYYYMMDDHHmmss_` timestamp
 * prefix drives ordering exactly like migration runners do (no locale collation).
 *
 * Unreadable entries (directories named `*.sql`, broken symlinks) are skipped
 * with a warning instead of aborting the scan; files reachable through several
 * paths (symlinks) are scanned once, de-duplicated by realpath.
 */
export async function discover(inputPath: string): Promise<DiscoverResult> {
  const abs = resolve(inputPath)
  if (!existsSync(abs)) {
    throw new Error(`Path not found: ${inputPath}`)
  }

  const info = await stat(abs)
  let files: string[]
  let scanRoot: string

  if (info.isFile()) {
    files = abs.endsWith('.sql') ? [abs] : []
    scanRoot = dirname(abs)
  } else {
    const nested = join(abs, 'supabase', 'migrations')
    scanRoot = existsSync(nested) ? nested : abs
    files = await findSqlFiles(scanRoot)
  }

  files.sort((a, b) => {
    const cmp = codepointCompare(basename(a), basename(b))
    return cmp !== 0 ? cmp : codepointCompare(a, b)
  })

  const cwd = process.cwd()
  const warnings: string[] = []
  const seenReal = new Set<string>()
  const result: MigrationFile[] = []

  for (const file of files) {
    try {
      const real = await realpath(file)
      if (seenReal.has(real)) continue // same physical file via a symlink
      seenReal.add(real)
      const content = await readFile(file, 'utf8')
      // Prefer a cwd-relative path; if the file sits outside cwd ('..' segments
      // break SARIF/annotation mapping), fall back to a scan-root-relative path.
      let rel = relative(cwd, file)
      if (rel.startsWith('..')) rel = relative(scanRoot, file)
      result.push({ abs: file, rel: toPosix(rel) || basename(file), content })
    } catch (err) {
      warnings.push(
        `skipped unreadable entry ${toPosix(relative(cwd, file))}: ${(err as Error).message}`,
      )
    }
  }

  return { files: result, warnings }
}
