import type { ParseResult } from './backend.js'
import { libpgBackend } from './libpg.js'
import { regexBackend } from './regex.js'

export type { ParseError, ParseResult, ParserBackend } from './backend.js'
export { splitStatements } from './splitter.js'

export type BackendChoice = 'auto' | 'libpg' | 'regex'

/**
 * Parse a single SQL file into normalized statements.
 *
 * `auto` (default) runs the precise libpg-query backend and transparently falls
 * back to the regex backend if the grammar rejects the file, so one unusual file
 * never aborts a scan.
 */
export async function parseSql(
  content: string,
  file: string,
  choice: BackendChoice = 'auto',
): Promise<ParseResult> {
  if (choice === 'regex') return regexBackend.parse(content, file)
  if (choice === 'libpg') return libpgBackend.parse(content, file)

  try {
    return await libpgBackend.parse(content, file)
  } catch (err) {
    const result = await regexBackend.parse(content, file)
    result.errors.push({
      message: `libpg-query could not parse this file; used regex fallback (${(err as Error).message})`,
      file,
    })
    return result
  }
}
