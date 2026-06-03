/**
 * Runtime validation for config loaded from disk. Config files are external
 * input, so we start from `unknown`, validate each field, and only then produce
 * a typed {@link UserConfig}. Invalid fields are dropped with a warning instead
 * of being trusted via a cast.
 */

import type { SensitiveColumnConfig, Severity, UserConfig } from '../core/types.js'

const SEVERITIES = new Set<Severity>(['critical', 'warning', 'info'])

function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && SEVERITIES.has(value as Severity)
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((v): v is string => typeof v === 'string')
}

export interface ConfigValidation {
  config: UserConfig
  warnings: string[]
}

export function parseUserConfig(raw: unknown): ConfigValidation {
  const warnings: string[] = []
  const config: UserConfig = {}

  if (raw == null) return { config, warnings }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('Config must be an object; ignoring it.')
    return { config, warnings }
  }

  const obj = raw as Record<string, unknown>
  const expect = (key: string, value: string[] | undefined, assign: (v: string[]) => void) => {
    if (obj[key] === undefined) return
    if (value) assign(value)
    else warnings.push(`Config "${key}" must be an array of strings; ignored.`)
  }

  expect('exposedSchemas', stringArray(obj.exposedSchemas), (v) => {
    config.exposedSchemas = v
  })
  expect('publicTables', stringArray(obj.publicTables), (v) => {
    config.publicTables = v
  })
  expect('disabledRules', stringArray(obj.disabledRules), (v) => {
    config.disabledRules = v
  })

  if (obj.failOn !== undefined) {
    if (isSeverity(obj.failOn)) config.failOn = obj.failOn
    else warnings.push('Config "failOn" must be one of critical|warning|info; ignored.')
  }

  if (obj.severity !== undefined) {
    const sev = obj.severity
    if (typeof sev === 'object' && sev !== null && !Array.isArray(sev)) {
      const out: Record<string, Severity> = {}
      for (const [id, value] of Object.entries(sev as Record<string, unknown>)) {
        if (isSeverity(value)) out[id] = value
        else warnings.push(`Config severity for "${id}" must be critical|warning|info; ignored.`)
      }
      config.severity = out
    } else {
      warnings.push('Config "severity" must be an object; ignored.')
    }
  }

  if (obj.sensitiveColumns !== undefined) {
    const sc = obj.sensitiveColumns
    if (typeof sc === 'object' && sc !== null && !Array.isArray(sc)) {
      const source = sc as Record<string, unknown>
      const out: Partial<SensitiveColumnConfig> = {}
      for (const tier of ['critical', 'warning', 'info'] as const) {
        if (source[tier] === undefined) continue
        const list = stringArray(source[tier])
        if (list) out[tier] = list
        else warnings.push(`Config sensitiveColumns.${tier} must be a string array; ignored.`)
      }
      config.sensitiveColumns = out
    } else {
      warnings.push('Config "sensitiveColumns" must be an object; ignored.')
    }
  }

  return { config, warnings }
}
