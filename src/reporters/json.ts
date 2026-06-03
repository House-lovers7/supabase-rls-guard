import type { ScanResult } from '../core/types.js'

export function renderJson(result: ScanResult): string {
  return JSON.stringify(
    {
      summary: result.summary,
      findings: result.findings,
      warnings: result.warnings,
    },
    null,
    2,
  )
}
