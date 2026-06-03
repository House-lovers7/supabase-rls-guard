/**
 * Inline suppression directives embedded in SQL comments:
 *
 *   -- rls-guard-disable-file              (whole file, all rules)
 *   -- rls-guard-disable-file RLS001 RLS004
 *   -- rls-guard-disable-next-line RLS001  (the statement on the next line)
 *   -- rls-guard-disable-line RLS001       (a finding reported on this line)
 *
 * A directive with no rule ids suppresses every rule. Rule ids are required for
 * targeted suppression so coverage is never silently lost wholesale by accident.
 */

export type RuleSet = Set<string> | 'all'

export interface FileSuppressions {
  file: RuleSet | null
  line: Map<number, RuleSet>
}

const FILE_RE = /rls-guard-disable-file\b(.*)/i
const NEXT_LINE_RE = /rls-guard-disable-next-line\b(.*)/i
const SAME_LINE_RE = /rls-guard-disable-line\b(.*)/i

function parseRuleList(rest: string): RuleSet {
  const ids = rest.match(/RLS\d+/gi)
  if (!ids || ids.length === 0) return 'all'
  return new Set(ids.map((id) => id.toUpperCase()))
}

function merge(existing: RuleSet | undefined, incoming: RuleSet): RuleSet {
  if (!existing) return incoming
  if (existing === 'all' || incoming === 'all') return 'all'
  return new Set([...existing, ...incoming])
}

export function parseSuppressions(content: string): FileSuppressions {
  const result: FileSuppressions = { file: null, line: new Map() }
  const lines = content.split('\n')

  lines.forEach((text, idx) => {
    const lineNo = idx + 1

    const fileMatch = FILE_RE.exec(text)
    if (fileMatch) {
      result.file = merge(result.file ?? undefined, parseRuleList(fileMatch[1] ?? ''))
    }

    const nextLineMatch = NEXT_LINE_RE.exec(text)
    if (nextLineMatch) {
      const target = lineNo + 1
      result.line.set(target, merge(result.line.get(target), parseRuleList(nextLineMatch[1] ?? '')))
    }

    const sameLineMatch = SAME_LINE_RE.exec(text)
    if (sameLineMatch) {
      result.line.set(lineNo, merge(result.line.get(lineNo), parseRuleList(sameLineMatch[1] ?? '')))
    }
  })

  return result
}

function inSet(set: RuleSet, ruleId: string): boolean {
  return set === 'all' || set.has(ruleId.toUpperCase())
}

export function isSuppressed(sup: FileSuppressions, ruleId: string, line: number): boolean {
  if (sup.file && inSet(sup.file, ruleId)) return true
  const lineSet = sup.line.get(line)
  return lineSet != null && inSet(lineSet, ruleId)
}
