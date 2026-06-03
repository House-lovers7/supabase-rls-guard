# Known limitations

`supabase-rls-guard` does **static analysis of migration SQL files only**. It is
a pre-deploy guardrail that shifts common RLS mistakes left — it is **not** a
replacement for the [Supabase Security Advisor / Splinter](https://supabase.com/docs/guides/database/database-linter),
for testing against a live database, or for manual security review. Treat a clean
run as "no *known, statically-detectable* mistakes found," not as a security
guarantee.

This page is deliberately explicit about what the tool can and cannot do, because
a security tool is dangerous the moment it is over-trusted.

## What it detects well

- The 13 rules in [rules.md](./rules.md) (RLS not enabled, policy without RLS,
  always-true policies, `user_metadata` trust, definer views, mutable
  `search_path`, sensitive columns on unprotected tables, broad `anon` grants,
  unwrapped `auth.uid()`, etc.).
- **Cross-file truth.** All migrations are folded in timestamp order, so RLS
  enabled in a later migration than the `CREATE TABLE` is correctly *not* flagged.
- Policies/tables/views/functions/grants declared in your `.sql` migrations,
  parsed with the real PostgreSQL grammar (libpg-query).

## What it does NOT detect (yet)

These are out of scope or tracked as open issues — contributions welcome.

- **Schema created outside migrations.** Tables/columns created via the Supabase
  dashboard or SQL editor are not in your repo, so the tool can't see them. (Run
  the Supabase Advisor for the live database.)
- **`REVOKE` is applied conservatively** — a grant is only cleared when a later
  `REVOKE` *fully* covers it (all of its grantees and privileges). A partial
  revoke leaves the grant in place (so `RLS005` keeps flagging — the safe
  direction).
- **`CREATE TABLE AS`** — the resulting column list is unknown, so column-level
  rules can't inspect it.
- **Dynamically generated SQL** — policies created inside `DO $$ … EXECUTE … $$`
  blocks are not analyzable.
- **Anything requiring a live database** — index usage, table bloat, extension
  versions, multiple-permissive-policy *performance*, and other Splinter lints
  that query the running catalog/stats.

## Where it can produce false positives

The tool errs toward flagging; review these before acting, and use the escape
hatches below.

- **Intentionally public data.** A `SELECT USING (true)` (or an
  `RLS001`/`RLS006` hit) on a table you *mean* to be world-readable (public
  reference data, listings) is a true positive but an intended one — add it to
  `publicTables`.
- **Public definer views.** `RLS010` flags every public view lacking
  `security_invoker`; if a view is intentionally a public projection, downgrade
  it with a per-rule `severity` override or the allowlist.
- **Exposed-schema assumption.** It assumes the `public` schema is API-exposed
  (the Supabase default). If you expose/hide schemas differently, set
  `exposedSchemas` — otherwise non-exposed tables may be flagged.

## Parser fallback

When libpg-query cannot parse a file, the tool falls back to a regex backend and
**emits a warning on stderr** (`… used regex fallback …`). The fallback is
resilient but less precise and may miss policies written in unusual syntax. You
can force a backend with `--backend libpg|regex`.

## Tuning

| Need | Mechanism |
| --- | --- |
| Allow an intentionally-public table | `publicTables` in config |
| Turn a rule off | `disabledRules` / `--disable` |
| Re-level a rule | `severity` override in config |
| One-off exception | `-- rls-guard-disable-next-line RLS0NN` |
| Change the CI gate | `--strict` / `--fail-on <severity>` |

See the [README](../README.md#configuration) for config details.
