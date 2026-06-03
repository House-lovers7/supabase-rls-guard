# AGENTS.md

Operating guide for AI coding agents (OpenAI Codex, Claude Code, Cursor, and
friends) working in this repository. Humans are welcome to read it too — it
doubles as the architecture map.

## Mission

Build and maintain a small, reliable CLI that statically scans Supabase
migration SQL for dangerous Row Level Security mistakes, so developers — and the
AI agents working alongside them — catch security regressions **before** they
ship. Precision matters more than coverage: a false positive that cries wolf is
worse than a missing edge case.

## Principles

- **Static-first.** The default scan never connects to a database and never
  needs Supabase credentials. Keep it that way.
- **Fold, don't guess.** Migrations are cumulative. Always evaluate rules against
  the *final* folded schema state, never a single file in isolation. This is the
  single most important correctness property — see `src/core/schema-state.ts`.
- **External input starts as `unknown`.** Config files and the libpg-query parse
  tree are untyped external data. Validate/normalize them (`src/config/validate.ts`,
  `src/parser/ast.ts`) before trusting them. No `any`; no unchecked `as` on
  external data.
- **Typed boundaries.** The parser is the parse/validate layer: it turns
  `unknown` into the typed `Statement` model in `src/core/types.ts`. Everything
  downstream is fully typed and never touches a raw AST.
- **Severity honesty.** Only Critical findings fail CI by default. Don't promote
  a noisy heuristic to Critical to make it feel important.
- **No silent gaps.** If a file can't be parsed, fall back and record a warning —
  never drop it quietly.

## Architecture

```
src/
  cli.ts                 # citty CLI: flags, exit codes, stdout/stderr
  index.ts               # public library API (scan, types, rules, reporters)
  core/
    scan.ts              # orchestrator: discover → parse → fold → evaluate → report
    discover.ts          # find & timestamp-sort migration files
    schema-state.ts      # fold Statement[] into the final SchemaState
    location.ts          # offset → line/column; trivia skipping
    types.ts             # the typed domain model (Statement, SchemaState, Finding…)
  parser/
    index.ts             # backend selection (libpg → regex fallback)
    libpg.ts             # primary backend: libpg-query WASM → Statement[]
    regex.ts             # fallback backend: heuristic matchers
    splitter.ts          # comment/dollar-quote-aware statement splitter
    ast.ts               # safe `unknown` accessors for the parse tree
    sql-text.ts          # text helpers (clause extraction, always-true detection)
  rules/                 # one Rule per check, grouped by theme; registry.ts lists them
  reporters/             # text | json | github | sarif
  config/                # cosmiconfig load + runtime validation + suppressions
```

Data flow: `scan()` discovers and orders files, parses each into `Statement[]`,
folds them all into one `SchemaState`, runs every enabled `Rule` against it,
drops suppressed findings, and summarizes.

## Adding a rule

1. Add a `Rule` object in the relevant `src/rules/*.ts` file (or a new one). Give
   it a stable `id` (`RLS0NN`), a Splinter-aligned `name`, a `defaultSeverity`,
   a one-line `description`, and `docs`.
2. Register it in `src/rules/registry.ts` (`ALL_RULES`).
3. Add unit tests in `tests/rules.test.ts` — at least one fires case and one
   does-not-fire case. Use the `analyze()` helper.
4. Document it in `docs/rules.md` and the README table.
5. If it should gate CI, make it Critical; otherwise Warning/Info.

## Conventions

- TypeScript, ESM only, Node ≥ 22.12 at runtime.
- `interface` for object shapes; `type` for unions/intersections.
- Prefer pure functions; rules are `(ctx) => Finding[]` with no side effects.
- Keep messages actionable: every finding carries a concrete `fix`.

## Commands

```bash
pnpm install
pnpm dev          # tsdown --watch
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check .
pnpm lint:fix     # biome check --write .
pnpm test         # vitest run
pnpm build        # tsdown → dist/
pnpm selfscan     # dogfood: run the built CLI on the unsafe example
```

> The build tool (tsdown) requires Node ≥ 22.18; the published package runs on
> Node ≥ 22.12. Use Node 22.18+ or 24 to build.

## Definition of done (for any change)

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are all green.
- New behavior has tests. New rules update `docs/rules.md` and the README.
- The unsafe example still surfaces findings; the safe example stays clean
  (`pnpm test` covers both).

## Non-goals

- Do not add a database connection to the default scan.
- Do not claim complete security coverage.
- Do not parse every valid PostgreSQL construct in v0.
- Do not commit real project migrations, Supabase URLs, anon/service-role
  (publishable/secret) keys, or any customer data. The `examples/` are synthetic.
