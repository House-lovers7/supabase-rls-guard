import type { ScanResult, Severity } from '../core/types.js'
import { ALL_RULES } from '../rules/registry.js'
import { HOMEPAGE, TOOL_NAME, VERSION } from '../version.js'

function sarifLevel(severity: Severity): 'error' | 'warning' | 'note' {
  if (severity === 'critical') return 'error'
  if (severity === 'warning') return 'warning'
  return 'note'
}

interface SarifRule {
  id: string
  name: string
  shortDescription: { text: string }
  defaultConfiguration: { level: 'error' | 'warning' | 'note' }
  helpUri?: string
  properties: { severity: Severity; splinter?: string }
}

/**
 * SARIF 2.1.0 output for GitHub Code Scanning (upload via
 * `github/codeql-action/upload-sarif`). Stable `ruleId`s and file paths keep
 * alert fingerprints consistent across runs.
 */
export function renderSarif(result: ScanResult): string {
  const rules: SarifRule[] = ALL_RULES.map((r) => ({
    id: r.id,
    name: r.name,
    shortDescription: { text: r.description },
    defaultConfiguration: { level: sarifLevel(r.defaultSeverity) },
    ...(r.docs ? { helpUri: r.docs } : {}),
    properties: { severity: r.defaultSeverity, ...(r.splinter ? { splinter: r.splinter } : {}) },
  }))

  const results = result.findings.map((f) => ({
    ruleId: f.ruleId,
    level: sarifLevel(f.severity),
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.loc.file },
          region: { startLine: Math.max(1, f.loc.line), startColumn: Math.max(1, f.loc.column) },
        },
      },
    ],
  }))

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: VERSION,
            informationUri: HOMEPAGE,
            rules,
          },
        },
        automationDetails: { id: 'supabase-rls-guard' },
        results,
      },
    ],
  }

  return JSON.stringify(sarif, null, 2)
}
