#!/usr/bin/env node
import { defineCommand, runMain } from 'citty'
import { scan } from './core/scan.js'
import type { OutputFormat, Severity } from './core/types.js'
import type { BackendChoice } from './parser/index.js'
import { render } from './reporters/index.js'
import { ruleList } from './rules/registry.js'
import { TOOL_NAME, VERSION } from './version.js'

const FORMATS: OutputFormat[] = ['text', 'json', 'github', 'sarif']
const BACKENDS: BackendChoice[] = ['auto', 'libpg', 'regex']
const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

function printRules(): void {
  process.stdout.write(`${TOOL_NAME} v${VERSION} — rules:\n\n`)
  for (const r of ruleList()) {
    const splinter = r.splinter ? ` (splinter ${r.splinter})` : ''
    process.stdout.write(
      `  ${r.id}  [${r.defaultSeverity}]  ${r.name}${splinter}\n      ${r.description}\n`,
    )
  }
}

const main = defineCommand({
  meta: {
    name: TOOL_NAME,
    version: VERSION,
    description: 'Statically scan Supabase migrations for dangerous RLS mistakes before you ship.',
  },
  args: {
    path: {
      type: 'positional',
      required: false,
      default: 'supabase/migrations',
      description: 'Migration file, directory, or project root to scan',
    },
    format: {
      type: 'enum',
      options: FORMATS,
      default: 'text',
      description: 'Output format: text | json | github | sarif',
    },
    backend: {
      type: 'enum',
      options: BACKENDS,
      default: 'auto',
      description: 'SQL parser backend: auto | libpg | regex',
    },
    strict: {
      type: 'boolean',
      default: false,
      description: 'Treat warnings as failures (exit non-zero)',
    },
    'fail-on': {
      type: 'enum',
      options: SEVERITIES,
      description: 'Severity that causes a non-zero exit (default: critical)',
    },
    config: { type: 'string', description: 'Path to a config file (overrides auto-discovery)' },
    disable: {
      type: 'string',
      description: 'Comma-separated rule ids to disable (e.g. RLS002,RLS011)',
    },
    color: {
      type: 'boolean',
      default: true,
      description: 'Colorize text output (use --no-color to disable)',
    },
    quiet: { type: 'boolean', default: false, description: 'Suppress warnings on stderr' },
    'list-rules': { type: 'boolean', default: false, description: 'Print all rules and exit' },
  },
  async run({ args }) {
    if (args['list-rules']) {
      printRules()
      return
    }

    const format = args.format as OutputFormat
    const failOn = (args['fail-on'] || undefined) as Severity | undefined
    const disableRules =
      typeof args.disable === 'string' && args.disable.length > 0
        ? args.disable
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined

    try {
      const result = await scan({
        path: String(args.path),
        backend: args.backend as BackendChoice,
        strict: Boolean(args.strict),
        failOn,
        configPath: typeof args.config === 'string' ? args.config : undefined,
        disableRules,
      })

      const output = render(result, format, { color: Boolean(args.color) })
      process.stdout.write(`${output}\n`)

      if (!args.quiet) {
        if (result.summary.filesScanned === 0) {
          process.stderr.write(`warning: no .sql files found at "${args.path}"\n`)
        }
        for (const w of result.warnings) process.stderr.write(`warning: ${w}\n`)
      }

      process.exit(result.summary.failed ? 1 : 0)
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(2)
    }
  },
})

runMain(main)
