import type { ScanResult, Severity } from '../core/types.js'

function command(severity: Severity): 'error' | 'warning' | 'notice' {
  if (severity === 'critical') return 'error'
  if (severity === 'warning') return 'warning'
  return 'notice'
}

function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function escapeProp(s: string): string {
  return escapeData(s).replace(/,/g, '%2C').replace(/:/g, '%3A')
}

/**
 * GitHub Actions workflow commands, which render as inline annotations on a PR.
 * No dependency required — Actions interprets `::error file=...::message` lines.
 */
export function renderGithub(result: ScanResult): string {
  const lines = result.findings.map((f) => {
    const props = [
      `file=${escapeProp(f.loc.file)}`,
      `line=${f.loc.line}`,
      `col=${f.loc.column}`,
      `title=${escapeProp(`${f.ruleId} ${f.target}`)}`,
    ].join(',')
    return `::${command(f.severity)} ${props}::${escapeData(f.message)}`
  })

  const { critical, warning, info } = result.summary
  lines.push(
    `::notice::supabase-rls-guard found ${critical} critical, ${warning} warning, ${info} info`,
  )
  return lines.join('\n')
}
