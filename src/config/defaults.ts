import type { ResolvedConfig, SensitiveColumnConfig, Severity } from '../core/types.js'

/**
 * Sensitive column name keywords, mirroring Supabase Splinter's
 * `0023_sensitive_columns_exposed` list. Single-word keywords match on token
 * boundaries (so `token` does not match `tokenized_at`); keywords containing
 * `_` match as substrings.
 */
export const DEFAULT_SENSITIVE_COLUMNS: SensitiveColumnConfig = {
  critical: [
    'password',
    'passwd',
    'password_hash',
    'secret',
    'api_key',
    'apikey',
    'private_key',
    'secret_key',
    'access_token',
    'refresh_token',
    'token',
    'jwt',
    'session_token',
    'cvv',
    'card_number',
    'credit_card',
    'ssn',
    'social_security',
    'bank_account',
    'iban',
    'routing_number',
    'tax_id',
    'otp_secret',
    'totp_secret',
    'mfa_secret',
  ],
  warning: [
    'phone_number',
    'date_of_birth',
    'national_id',
    'passport_number',
    'drivers_license',
    'ip_address',
    'address',
  ],
  info: ['email', 'phone'],
}

export const DEFAULT_FAIL_ON: Severity = 'critical'

export function baseConfig(): ResolvedConfig {
  return {
    exposedSchemas: ['public'],
    publicTables: [],
    sensitiveColumns: {
      critical: [...DEFAULT_SENSITIVE_COLUMNS.critical],
      warning: [...DEFAULT_SENSITIVE_COLUMNS.warning],
      info: [...DEFAULT_SENSITIVE_COLUMNS.info],
    },
    disabledRules: new Set(),
    severity: {},
    failOn: DEFAULT_FAIL_ON,
    warnings: [],
  }
}

/** Returns the highest severity matched by a column name, or `null`. */
export function severityForColumn(columnName: string, cfg: SensitiveColumnConfig): Severity | null {
  const name = columnName.toLowerCase()
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean)
  const matches = (keyword: string): boolean =>
    keyword.includes('_') ? name.includes(keyword) : tokens.includes(keyword)

  if (cfg.critical.some(matches)) return 'critical'
  if (cfg.warning.some(matches)) return 'warning'
  if (cfg.info.some(matches)) return 'info'
  return null
}
