/**
 * A SQL statement splitter that is aware of the constructs naive `split(';')`
 * breaks on: line comments, block comments, single-quoted strings, and
 * dollar-quoted bodies (`$$ ... $$`, `$tag$ ... $tag$`). Used by the regex
 * fallback backend when libpg-query cannot parse a file.
 */

import { skipLeadingTrivia } from '../core/location.js'

export interface RawStatement {
  /** Statement text, excluding the terminating semicolon. */
  text: string
  /** Byte offset of the first real token in `text` (past whitespace/comments). */
  offset: number
}

const DOLLAR_OPEN = /^\$([A-Za-z_]\w*)?\$/

export function splitStatements(content: string): RawStatement[] {
  const result: RawStatement[] = []
  const n = content.length
  let i = 0
  let stmtStart = 0
  let inSingle = false
  let inLineComment = false
  let inBlockComment = false
  let dollarTag: string | null = null

  const push = (end: number) => {
    const text = content.slice(stmtStart, end)
    if (text.trim()) result.push({ text, offset: skipLeadingTrivia(content, stmtStart, end) })
  }

  while (i < n) {
    const c = content[i]
    const c2 = content[i + 1]

    if (inLineComment) {
      if (c === '\n') inLineComment = false
      i++
      continue
    }
    if (inBlockComment) {
      if (c === '*' && c2 === '/') {
        inBlockComment = false
        i += 2
        continue
      }
      i++
      continue
    }
    if (inSingle) {
      if (c === "'") {
        if (c2 === "'") {
          i += 2
          continue
        }
        inSingle = false
      }
      i++
      continue
    }
    if (dollarTag) {
      if (c === '$' && content.startsWith(dollarTag, i)) {
        i += dollarTag.length
        dollarTag = null
        continue
      }
      i++
      continue
    }

    if (c === '-' && c2 === '-') {
      inLineComment = true
      i += 2
      continue
    }
    if (c === '/' && c2 === '*') {
      inBlockComment = true
      i += 2
      continue
    }
    if (c === "'") {
      inSingle = true
      i++
      continue
    }
    if (c === '$') {
      const m = DOLLAR_OPEN.exec(content.slice(i))
      if (m) {
        dollarTag = m[0]
        i += m[0].length
        continue
      }
      i++
      continue
    }
    if (c === ';') {
      push(i)
      i++
      stmtStart = i
      continue
    }
    i++
  }

  push(n)
  return result
}
