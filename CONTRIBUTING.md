# Contributing

Thanks for your interest in improving Supabase RLS Guard! Contributions of all
sizes are welcome — bug reports, new rules, docs, and tests especially.

## Getting started

```bash
git clone https://github.com/your-username/supabase-rls-guard
cd supabase-rls-guard
pnpm install
pnpm test
```

> Requires Node ≥ 22.18 to build (tsdown) and pnpm. The published package runs on
> Node ≥ 22.12.

## Development workflow

```bash
pnpm dev          # rebuild on change
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check .
pnpm lint:fix     # auto-fix lint/format
pnpm test         # vitest run
pnpm test:watch   # vitest watch
pnpm build        # produce dist/
pnpm selfscan     # run the built CLI against the unsafe example
```

Before opening a PR, make sure `pnpm typecheck`, `pnpm lint`, and `pnpm test`
all pass. CI runs the same checks.

## Adding or changing a rule

See the "Adding a rule" section of [AGENTS.md](./AGENTS.md). In short:

1. Add the `Rule` object under `src/rules/`.
2. Register it in `src/rules/registry.ts`.
3. Add fires / does-not-fire tests in `tests/rules.test.ts`.
4. Update `docs/rules.md` and the README rule table.

New rules should be Critical only if they represent a genuine, high-confidence
security hole that should block a deploy. Otherwise prefer Warning or Info to
keep false positives out of CI gates.

## Commit & PR conventions

- Keep PRs focused. One logical change per PR.
- Reference any related issue.
- Describe the rule/behavior change and include an example of the SQL it
  affects.
- Never include real project migrations, Supabase URLs, or API keys. The
  `examples/` directories are synthetic and must stay that way.

## Code style

- TypeScript, ESM only.
- Formatting and linting are handled by Biome (`biome.json`); run `pnpm lint:fix`.
- Prefer pure functions and explicit types. External/untyped input (config,
  parse tree) must be validated before use — no `any`, no unchecked `as`.

## Reporting bugs

Open an issue using the bug report template, and include the smallest migration
SQL snippet that reproduces the behavior plus the command you ran.

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
