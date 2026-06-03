## What & why

<!-- What does this change do, and why? Link any related issue. -->

## Type of change

- [ ] Bug fix (false positive / false negative / crash)
- [ ] New rule
- [ ] Docs
- [ ] Tooling / CI
- [ ] Other

## For rule changes

- [ ] Added a `Rule` and registered it in `src/rules/registry.ts`
- [ ] Added fires / does-not-fire tests in `tests/rules.test.ts`
- [ ] Updated `docs/rules.md` and the README rule table
- [ ] Chose Critical only if it should block a deploy

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] No real migrations, Supabase URLs, or API keys were added
