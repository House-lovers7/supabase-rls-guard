import { cosmiconfig } from 'cosmiconfig'
import {
  type ResolvedConfig,
  SEVERITY_ORDER,
  type Severity,
  type UserConfig,
} from '../core/types.js'
import { baseConfig } from './defaults.js'
import { parseUserConfig } from './validate.js'

export interface ConfigOverrides {
  /** Explicit config file path (skips automatic discovery). */
  configPath?: string
  /** From `--fail-on`. */
  failOn?: Severity
  /** From `--strict` (lowers the gate to `warning`). */
  strict?: boolean
  /** From repeated `--disable RLSxxx`. */
  disableRules?: string[]
  /** Search start directory (defaults to cwd). */
  cwd?: string
}

function mergeConfig(user: UserConfig, overrides: ConfigOverrides): ResolvedConfig {
  const cfg = baseConfig()

  if (user.exposedSchemas) cfg.exposedSchemas = user.exposedSchemas
  if (user.publicTables) cfg.publicTables = user.publicTables
  if (user.sensitiveColumns) {
    cfg.sensitiveColumns = {
      critical: user.sensitiveColumns.critical ?? cfg.sensitiveColumns.critical,
      warning: user.sensitiveColumns.warning ?? cfg.sensitiveColumns.warning,
      info: user.sensitiveColumns.info ?? cfg.sensitiveColumns.info,
    }
  }
  if (user.disabledRules) {
    for (const id of user.disabledRules) cfg.disabledRules.add(id.toUpperCase())
  }
  if (user.severity) {
    for (const [id, sev] of Object.entries(user.severity)) cfg.severity[id.toUpperCase()] = sev
  }
  if (user.failOn) cfg.failOn = user.failOn

  // CLI overrides win over file config.
  // --strict only ever LOWERS the gate (to warning); it must never weaken a
  // stricter file config such as `failOn: "info"`.
  if (overrides.strict && SEVERITY_ORDER[cfg.failOn] > SEVERITY_ORDER.warning) {
    cfg.failOn = 'warning'
  }
  if (overrides.failOn) cfg.failOn = overrides.failOn
  for (const id of overrides.disableRules ?? []) cfg.disabledRules.add(id.toUpperCase())

  return cfg
}

export async function loadConfig(overrides: ConfigOverrides = {}): Promise<ResolvedConfig> {
  // Note: cosmiconfig rejects `stopDir` for any searchStrategy other than
  // "global"; `overrides.cwd` is the search *start* directory instead.
  const explorer = cosmiconfig('rlsguard', { searchStrategy: 'project' })

  const found = overrides.configPath
    ? await explorer.load(overrides.configPath)
    : await explorer.search(overrides.cwd)

  // Config from disk is untyped external input: validate before trusting it.
  const { config: user, warnings } = parseUserConfig(found && !found.isEmpty ? found.config : null)
  const cfg = mergeConfig(user, overrides)
  cfg.warnings = warnings
  if (found?.filepath) cfg.configPath = found.filepath
  return cfg
}
