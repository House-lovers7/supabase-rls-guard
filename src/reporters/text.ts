import pc from 'picocolors'
import type { ScanResult, Severity } from '../core/types.js'

type ColorFns = ReturnType<typeof pc.createColors>

function badge(c: ColorFns, severity: Severity): string {
  switch (severity) {
    case 'critical':
      return c.bgRed(c.white(c.bold(' CRITICAL ')))
    case 'warning':
      return c.bgYellow(c.black(c.bold(' WARNING ')))
    case 'info':
      return c.bgCyan(c.black(c.bold(' INFO ')))
  }
}

function colorForSeverity(c: ColorFns, severity: Severity): (s: string) => string {
  switch (severity) {
    case 'critical':
      return c.red
    case 'warning':
      return c.yellow
    case 'info':
      return c.cyan
  }
}

export function renderText(result: ScanResult, enableColor = true): string {
  const c: ColorFns = enableColor ? pc : pc.createColors(false)
  const { findings, summary } = result
  const lines: string[] = []

  if (findings.length === 0) {
    if (result.warnings.length > 0) {
      const count = result.warnings.length
      return c.yellow(
        `⚠ No RLS findings across ${summary.filesScanned} file(s), but ${count} scan warning${
          count === 1 ? '' : 's'
        } prevent a clean pass.`,
      )
    }
    return c.green(`✔ No RLS issues found across ${summary.filesScanned} file(s).`)
  }

  for (const f of findings) {
    const color = colorForSeverity(c, f.severity)
    lines.push(`${badge(c, f.severity)} ${c.bold(f.ruleId)} ${color(f.target)}`)
    lines.push(`  ${f.message}`)
    lines.push(`  ${c.dim('↳')} ${c.dim(`${f.loc.file}:${f.loc.line}:${f.loc.column}`)}`)
    if (f.fix) lines.push(`  ${c.dim('↳ fix:')} ${f.fix}`)
    if (f.docs) lines.push(`  ${c.dim('↳ docs:')} ${c.underline(f.docs)}`)
    lines.push('')
  }

  const parts: string[] = []
  if (summary.critical) parts.push(c.red(`${summary.critical} critical`))
  if (summary.warning) parts.push(c.yellow(`${summary.warning} warning`))
  if (summary.info) parts.push(c.cyan(`${summary.info} info`))
  const icon = summary.failed ? c.red('✖') : c.yellow('⚠')
  const scanWarningSuffix = result.warnings.length
    ? c.yellow(
        ` · scan incomplete: ${result.warnings.length} scan warning${
          result.warnings.length === 1 ? '' : 's'
        }`,
      )
    : ''
  lines.push(
    `${icon} ${parts.join(', ')} across ${summary.filesScanned} file(s)${
      summary.failed ? c.red(` · failing (threshold: ${result.config.failOn})`) : ''
    }${scanWarningSuffix}`,
  )

  return lines.join('\n')
}
