/**
 * Detects RLS DDL hidden inside dollar-quoted bodies (`DO $$ … EXECUTE … $$`,
 * plpgsql function bodies). Such statements are generated at run time — often
 * from a catalog query like `SELECT tablename FROM pg_tables` — so a static
 * fold cannot know which tables they touch.
 *
 * The tool deliberately does *not* suppress findings for those tables: a block
 * that enables RLS everywhere and a block that misses the table you care about
 * are indistinguishable here, and hiding a real gap is the worse error. Instead
 * the scan reports that part of the schema was not analyzable, which folds into
 * the existing incomplete-scan contract (`--strict` exits 2).
 */

import { LineIndex } from '../core/location.js'
import { lexSql } from './splitter.js'

const RLS_DDL_RE = /\b(?:enable|disable)\s+row\s+level\s+security\b|\b(?:create|drop)\s+policy\b/i

/**
 * Returns at most one scan warning per file, anchored at the first occurrence.
 * One block per file is the common shape, and a warning per generated statement
 * would say the same thing many times.
 */
export function detectDynamicRlsDdl(content: string, file: string): string[] {
  for (const body of lexSql(content).dollarBodies) {
    const match = RLS_DDL_RE.exec(content.slice(body.start, body.end))
    if (!match) continue
    const { line } = new LineIndex(content).locate(body.start + match.index)
    return [
      `${file}:${line}: RLS DDL inside a dollar-quoted block is generated at run time and cannot be analyzed statically; tables secured only there are still reported as unprotected`,
    ]
  }
  return []
}
