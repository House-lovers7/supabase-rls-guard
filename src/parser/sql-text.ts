/** Text utilities shared by the regex fallback backend. */

import type { TableRef } from '../core/types.js'

/** `public.users` / `"My Table"` / `users` -> `{ schema, name }` (defaults schema to `public`). */
export function parseQualifiedName(raw: string): TableRef {
  const parts = splitQualified(raw)
  if (parts.length >= 2) return { schema: unquote(parts[0]!), name: unquote(parts[1]!) }
  return { schema: 'public', name: unquote(parts[0] ?? '') }
}

function splitQualified(raw: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of raw.trim()) {
    if (ch === '"') {
      inQuote = !inQuote
      current += ch
    } else if (ch === '.' && !inQuote) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return parts
}

function unquote(s: string): string {
  const t = s.trim()
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t
}

/**
 * Extracts the balanced-parenthesis content immediately following a keyword.
 * `extractParenAfter("USING (a = b)", /using/i)` -> `"a = b"`.
 */
export function extractParenAfter(text: string, keyword: RegExp): string | undefined {
  const m = keyword.exec(text)
  if (!m) return undefined
  let i = (m.index ?? 0) + m[0].length
  while (i < text.length && text[i] !== '(') {
    if (!/\s/.test(text[i] as string)) return undefined
    i++
  }
  if (text[i] !== '(') return undefined
  let depth = 0
  const start = i
  for (; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return text.slice(start + 1, i).trim()
    }
  }
  return undefined
}

/** Recognizes always-pass predicates such as `true`, `1 = 1`, `'x' = 'x'`. */
export function isTextAlwaysTrue(clause: string | undefined): boolean {
  if (!clause) return false
  let s = clause.trim()
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim()
  if (/^true$/i.test(s)) return true
  const m = /^(\S+)\s*=\s*(\S+)$/.exec(s)
  return m != null && m[1] === m[2]
}
