#!/usr/bin/env node
import { defineCommand, runMain } from 'citty'
import { scan } from './core/scan.js'
import type { OutputFormat, Severity } from './core/types.js'
import type { BackendChoice } from './parser/index.js'
import { render } from './reporters/index.js'
import { ruleList } from './rules/registry.js'
import { TOOL_NAME, VERSION } from './version.js'

const FORMATS: readonly string[] = ['text', 'json', 'github', 'sarif']
const BACKENDS: readonly string[] = ['auto', 'libpg', 'regex']
const SEVERITIES: readonly string[] = ['critical', 'warning', 'info']

/**
 * Write to a stream and resolve once the chunk is flushed. `process.exit()`
 * discards data still queued on a piped stdout beyond the OS pipe buffer
 * (~64 KiB), silently truncating large reports — so every exit waits for its
 * output first.
 */
function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve) => {
    stream.write(text, () => resolve())
  })
}

async function fail(code: number, message: string): Promise<never> {
  await write(process.stderr, `error: ${message}\n`)
  process.exit(code)
}

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
  // Values are validated inside run() so that bad values exit 2 (tool/config
  // error) per the documented contract — citty's own enum validation exits 1,
  // indistinguishable from "findings present" in CI.
  args: {
    path: {
      type: 'positional',
      required: false,
      default: 'supabase/migrations',
      description: 'Migration file, directory, or project root to scan',
    },
    format: {
      type: 'string',
      default: 'text',
      description: 'Output format: text | json | github | sarif',
    },
    backend: {
      type: 'string',
      default: 'auto',
      description: 'SQL parser backend: auto | libpg | regex',
    },
    strict: {
      type: 'boolean',
      default: false,
      description:
        'Fail on warning-severity findings and reject incomplete scans with operational warnings',
    },
    'fail-on': {
      type: 'string',
      description:
        'Severity that causes a non-zero exit: critical | warning | info (default: critical)',
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
    'allow-empty': {
      type: 'boolean',
      default: false,
      description: 'Exit 0 when no .sql files are found (default: exit 2)',
    },
    'list-rules': { type: 'boolean', default: false, description: 'Print all rules and exit' },
  },
  async run({ args }) {
    if (args['list-rules']) {
      printRules()
      return
    }

    const format = String(args.format)
    if (!FORMATS.includes(format)) {
      await fail(2, `invalid --format "${format}" (expected one of: ${FORMATS.join(', ')})`)
    }
    const backend = String(args.backend)
    if (!BACKENDS.includes(backend)) {
      await fail(2, `invalid --backend "${backend}" (expected one of: ${BACKENDS.join(', ')})`)
    }
    const failOnRaw = args['fail-on']
    if (failOnRaw !== undefined && !SEVERITIES.includes(String(failOnRaw))) {
      await fail(2, `invalid --fail-on "${failOnRaw}" (expected one of: ${SEVERITIES.join(', ')})`)
    }

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
        backend: backend as BackendChoice,
        strict: Boolean(args.strict),
        failOn: failOnRaw !== undefined ? (String(failOnRaw) as Severity) : undefined,
        configPath: typeof args.config === 'string' ? args.config : undefined,
        disableRules,
      })

      // A zero-file scan is a misconfigured path, not a clean pass — fail closed.
      // (Not silenced by --quiet: a security gate must not pass silently on nothing.)
      if (result.summary.filesScanned === 0 && !args['allow-empty']) {
        await fail(
          2,
          `no .sql files found at "${args.path}" — nothing was scanned (use --allow-empty to permit this)`,
        )
      }

      const output = render(result, format as OutputFormat, { color: Boolean(args.color) })
      await write(process.stdout, `${output}\n`)

      if (!args.quiet) {
        for (const w of result.warnings) await write(process.stderr, `warning: ${w}\n`)
      }

      // Parser fallback, unreadable entries, and invalid config fields mean the
      // result is incomplete. In strict mode they are tool errors (exit 2), not
      // security findings (exit 1). Keep the rendered partial result on stdout
      // so CI and operators still have evidence to review.
      if (args.strict && result.warnings.length > 0) {
        const count = result.warnings.length
        await fail(
          2,
          `strict mode rejected ${count} scan warning${count === 1 ? '' : 's'}; the result is incomplete${
            args.quiet ? ' (rerun without --quiet for details)' : ''
          }`,
        )
      }

      process.exit(result.summary.failed ? 1 : 0)
    } catch (err) {
      await fail(2, err instanceof Error ? err.message : String(err))
    }
  },
})

runMain(main)
