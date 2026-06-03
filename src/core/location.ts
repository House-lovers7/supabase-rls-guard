/**
 * Advances past leading whitespace and SQL comments (`-- ...`, block comments)
 * so an offset points at the first real token. libpg-query reports a
 * statement's location as the position right after the previous `;`, which
 * includes any leading trivia — this corrects it for accurate line numbers.
 */
export function skipLeadingTrivia(content: string, start: number, end = content.length): number {
  let i = start
  while (i < end) {
    const c = content[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
    } else if (c === '-' && content[i + 1] === '-') {
      i += 2
      while (i < end && content[i] !== '\n') i++
    } else if (c === '/' && content[i + 1] === '*') {
      i += 2
      while (i < end && !(content[i] === '*' && content[i + 1] === '/')) i++
      i += 2
    } else {
      break
    }
  }
  return i
}

/** Maps byte offsets within a file to 1-based line/column positions. */
export class LineIndex {
  private readonly starts: number[]

  constructor(private readonly content: string) {
    this.starts = [0]
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') this.starts.push(i + 1)
    }
  }

  locate(offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, this.content.length))
    let lo = 0
    let hi = this.starts.length - 1
    let ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.starts[mid]! <= clamped) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return { line: ans + 1, column: clamped - this.starts[ans]! + 1 }
  }
}
