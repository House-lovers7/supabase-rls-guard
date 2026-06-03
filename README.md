# Supabase RLS Guard

> **Static pre-deploy linter for Supabase Row Level Security.** Catch missing RLS,
> unsafe policies, risky `anon` grants, and insecure views in your migration SQL —
> **before** they reach production. No database connection required.
>
> Built for AI-assisted development, where it's easy to ship a migration that
> forgets RLS.

[![CI](https://github.com/House-lovers7/supabase-rls-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/House-lovers7/supabase-rls-guard/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/supabase-rls-guard.svg)](https://www.npmjs.com/package/supabase-rls-guard)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/supabase-rls-guard.svg)](https://nodejs.org)

```bash
npx supabase-rls-guard ./supabase/migrations
```

> [!IMPORTANT]
> **A pre-deploy guardrail, not a guarantee.** This shifts common RLS mistakes
> left (editor / pre-commit / PR), but it is **not** a replacement for the
> [Supabase Security Advisor / Splinter](https://supabase.com/docs/guides/database/database-linter)
> or for manual review — those run against your live database and catch more. It
> does static analysis of migration files only. See
> [docs/known-limitations.md](./docs/known-limitations.md) for exactly what it
> can and cannot detect.

### Catch it on the pull request

Drop this in `.github/workflows/rls-guard.yml` to fail any PR that adds a
dangerous RLS migration (findings show up as inline annotations on the diff):

```yaml
name: rls-guard
on:
  pull_request:
    paths: ['supabase/migrations/**.sql']
jobs:
  rls-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx supabase-rls-guard ./supabase/migrations --format github
```

More recipes — SARIF / GitHub Code Scanning, pre-commit, GitLab CI — in
[docs/ci-integration.md](./docs/ci-integration.md).

---

## Why this exists

AI-assisted development (Cursor, Lovable, Bolt, Claude Code, Codex…) makes it
trivial to build a Supabase app in an afternoon. It also makes it trivial to
ship a `public` table with **no Row Level Security**, leaving your database
readable — and writable — by anyone with the anon/publishable key.

This is not hypothetical. **[CVE-2025-48757](https://supabase.com/blog/supabase-security-2025-retro)**
found that **10.3%** of analyzed endpoints across 170 AI-built projects were
readable by unauthenticated requests, because RLS was never enabled.

Supabase's own [Security Advisor](https://supabase.com/docs/guides/database/database-linter)
catches these — but only **after** you've deployed and connected a live
database. `supabase-rls-guard` runs on your local `.sql` files, so it catches
them in your editor, in a pre-commit hook, or in CI on the pull request.

> **The guardrail for AI-written migrations: catch RLS mistakes before a human
> reviews them and before they hit production. No database connection required.**

### Proven on real projects

Run against **14 real Supabase projects**, supabase-rls-guard reproduced **two
live Supabase Security Advisor alerts** (`rls_disabled_in_public` and
`sensitive_columns_exposed`) **purely from local migration files** — i.e. it
would have caught them before deploy. It also surfaced additional RLS-disabled
tables holding 2FA secrets and session tokens that the dashboard had not flagged
yet. (Aggregate only — no project names, schemas, or data are published.)

## What it checks

14 rules, aligned with Supabase's official [Splinter](https://github.com/supabase/splinter)
lint catalog where they overlap. Run `npx supabase-rls-guard --list-rules` for
the live list, or see [docs/rules.md](./docs/rules.md) for details and fixes.

| ID | Severity | What it catches |
| --- | --- | --- |
| `RLS001` | Critical | A table in an API-exposed schema has no RLS enabled |
| `RLS002` | Warning | RLS is enabled but no policy exists (every read returns nothing) |
| `RLS003` | Critical | A policy exists but RLS was never enabled — the policy is inert |
| `RLS004` | Warning/Info | A sensitive column (`password`, `token`, `ssn`…) on a table with no RLS |
| `RLS005` | Critical | `GRANT … TO anon` on a table without RLS |
| `RLS006` | Critical/Warning | A permissive policy with `USING (true)` |
| `RLS007` | Warning | A policy with no `TO` role (runs for every role, incl. anon) |
| `RLS008` | Warning | `auth.uid()` / `auth.jwt()` not wrapped in `(select …)` (perf) |
| `RLS009` | Critical | A policy trusts `user_metadata` (user-editable → privilege escalation) |
| `RLS010` | Critical | A view without `security_invoker` (bypasses the caller's RLS) |
| `RLS011` | Warning | A function without a fixed `search_path` |
| `RLS013` | Info | An `UPDATE` policy omits `WITH CHECK` (Postgres reuses `USING`) — be explicit if intended |
| `RLS017` | Warning | Multiple permissive policies for the same role + command (OR-ed on every row) |
| `RLS018` | Warning | A migration runs `ALTER TABLE … DISABLE ROW LEVEL SECURITY` |

## Example

**1. A migration with a classic mistake** — a public table with no RLS, holding a token:

```sql
-- supabase/migrations/001_api_keys.sql
create table public.api_keys (
  id uuid primary key,
  user_id uuid,
  token text not null
);
```

**2. The tool catches it before you deploy** (and exits non-zero, so CI fails):

```text
$ npx supabase-rls-guard ./supabase/migrations

 CRITICAL  RLS001 public.api_keys
  Table public.api_keys is in an API-exposed schema but RLS is not enabled — anyone with the anon/publishable key can read and write it.
  ↳ 001_api_keys.sql:1:1
  ↳ fix: ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

 CRITICAL  RLS004 public.api_keys.token
  Column public.api_keys.token looks sensitive and the table has no RLS — this data is exposed over the API.

✖ 2 critical across 1 file(s) · failing (threshold: critical)      # exit 1
```

**3. The fix** — RLS on, with a scoped policy. (RLS enabled in a *later* migration is correctly accepted.)

```sql
-- supabase/migrations/002_api_keys_rls.sql
alter table public.api_keys enable row level security;

create policy "api_keys_select_own"
  on public.api_keys
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
```

```text
$ npx supabase-rls-guard ./supabase/migrations
✔ No RLS issues found across 2 file(s).                            # exit 0
```

## The key idea: migrations are cumulative

A table created in `001_*.sql` and RLS-enabled in `002_*.sql` is **correct**.
A naive per-file scanner would flag a false positive on `001`.

`supabase-rls-guard` parses **every** migration in timestamp order, folds them
into the *final* schema state (applying `ENABLE`/`DISABLE`/`DROP`/`IF NOT EXISTS`
as transitions), and only then evaluates the rules. You get the truth about
what your database actually looks like after all migrations run — not file-by-file
guesses.

Under the hood it uses **[libpg-query](https://github.com/launchql/libpg-query-node)**
— the real PostgreSQL parser compiled to WASM — so dollar-quoted function
bodies, comments, and string literals never produce false positives. If a file
can't be parsed, it transparently falls back to a resilient regex backend.

## Usage

```bash
# scan the default location (./supabase/migrations)
npx supabase-rls-guard

# scan an explicit path (file, directory, or project root)
npx supabase-rls-guard ./supabase/migrations

# machine-readable output
npx supabase-rls-guard --format json
npx supabase-rls-guard --format sarif > rls.sarif

# fail CI on warnings too
npx supabase-rls-guard --strict

# list all rules
npx supabase-rls-guard --list-rules
```

### Options

| Flag | Description |
| --- | --- |
| `--format <text\|json\|github\|sarif>` | Output format (default `text`) |
| `--strict` | Treat warnings as failures |
| `--fail-on <critical\|warning\|info>` | Severity that triggers a non-zero exit (default `critical`) |
| `--config <file>` | Use a specific config file |
| `--disable RLS002,RLS011` | Disable rules for this run |
| `--backend <auto\|libpg\|regex>` | Parser backend (default `auto`) |
| `--no-color` | Disable ANSI colors |
| `--quiet` | Suppress warnings on stderr |
| `--list-rules` | Print all rules and exit |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No findings at or above the threshold |
| `1` | Findings at or above the threshold |
| `2` | Tool/config error (bad flag, path not found) |

## CI integration

Add a GitHub Actions workflow (see [docs/ci-integration.md](./docs/ci-integration.md)):

```yaml
name: rls-guard
on:
  pull_request:
    paths: ['supabase/migrations/**.sql']
jobs:
  rls-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx supabase-rls-guard ./supabase/migrations --format github
```

For pull-request alerts via GitHub Code Scanning, emit SARIF and upload it — see
[docs/ci-integration.md](./docs/ci-integration.md).

## Configuration

Drop a `.rlsguardrc.json` (or a `rlsguard` key in `package.json`) at your repo
root. All fields are optional:

```jsonc
{
  // schemas exposed over the Data API (default: ["public"])
  "exposedSchemas": ["public"],
  // tables that are intentionally world-readable (suppresses RLS001/RLS006)
  "publicTables": ["public.blog_posts"],
  // fail the build at this severity (default: "critical")
  "failOn": "critical",
  // turn rules off
  "disabledRules": ["RLS011"],
  // override a rule's severity
  "severity": { "RLS010": "warning" },
  // extend the sensitive-column keyword lists
  "sensitiveColumns": { "critical": ["pan", "vat_number"] }
}
```

### Inline suppressions

```sql
-- rls-guard-disable-next-line RLS001
create table public.intentionally_public (id int);

-- rls-guard-disable-file RLS011
```

## Use as a library

```ts
import { scan } from 'supabase-rls-guard'

const result = await scan({ path: 'supabase/migrations' })
console.log(result.summary) // { critical, warning, info, total, failed, ... }
for (const finding of result.findings) {
  console.log(finding.ruleId, finding.target, finding.message)
}
```

## How it compares

| Tool | When it runs | Needs a database? | Surface |
| --- | --- | --- | --- |
| **supabase-rls-guard** | Editor / pre-commit / PR CI | **No** | Local `.sql` migrations |
| Supabase Advisor / Splinter | After deploy | Yes (live DB) | Dashboard |
| pgrls | CI with Postgres | Yes (live/ephemeral DB) | Introspection |

It is a **complement** to the Supabase Advisor, not a replacement — it shifts the
same class of checks left, to before you ship.

## Non-goals

- It does **not** connect to your database, and never needs your keys.
- It is a static approximation of the live Splinter linter, not a substitute for it.
- It does not claim complete security coverage — it catches the common, costly mistakes.
- It does not parse every valid PostgreSQL construct (dynamically-generated SQL in `DO` blocks is out of scope).

## License

[MIT](./LICENSE) © House-lovers7.

This project is independent and not affiliated with or endorsed by Supabase Inc.
