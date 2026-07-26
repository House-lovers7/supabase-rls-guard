# Examples

Three self-contained Supabase projects used by the README, the demo, and the
test-suite. Scan them yourself (from the repo root, after `pnpm build`):

```sh
node dist/cli.mjs examples/unsafe-project/supabase/migrations        # exit 1
node dist/cli.mjs examples/safe-project/supabase/migrations          # exit 0
node dist/cli.mjs examples/dynamic-ddl-project/supabase/migrations   # exit 1, scan incomplete
```

Migrations are applied in filename order, and the scanner folds all of them
into one final schema state before evaluating rules — so a table created in
one file and secured in a later file is correctly **not** flagged.

## unsafe-project — 11 migrations, every finding intentional

Expected result: **11 critical, 6 warning, 3 info** across 11 files (exit 1).

| Migration | Demonstrates | Findings against the final state |
| --- | --- | --- |
| `001_create_users.sql` | Table with no RLS, holding sensitive columns | RLS001 (critical), RLS004 (critical `password_hash`, info `email`) |
| `002_create_todos.sql` | `todos` created *without* RLS here… | none — see next row |
| `003_enable_todos_rls.sql` | …RLS enabled + scoped policy in a **later** migration. Cumulative folding means `todos` is correctly not flagged | none (by design) |
| `004_posts.sql` | Permissive policy with `USING (true)` | RLS006 (critical), RLS013 (info) |
| `005_profiles.sql` | Policy without `TO` clause; unwrapped `auth.uid()` | RLS007 (warning), RLS008 (warning), RLS013 (info) |
| `006_api_keys.sql` | Policy exists but RLS never enabled; sensitive `token` column | RLS001, RLS003, RLS004 (all critical) |
| `007_admin_flags.sql` | Policy trusting `user_metadata` | RLS009 (critical), RLS008 (warning) |
| `008_views_functions.sql` | Definer view over protected data; function with mutable `search_path` | RLS010 (critical), RLS011 (warning) |
| `009_grants.sql` | `GRANT … TO anon` on a table without RLS | RLS001, RLS005 (both critical) |
| `010_settings.sql` | RLS enabled but no policy (locked-out table) | RLS002 (warning) |
| `011_legacy.sql` | RLS enabled, then `DISABLE`d in the same history (forgotten debug statement) | RLS001 (critical), RLS018 (warning) |

## safe-project — 3 migrations, clean pass

Expected result: `✔ No RLS issues found across 3 file(s).` (exit 0)

| Migration | Demonstrates |
| --- | --- |
| `001_profiles.sql` | RLS enabled in the same migration that creates the table |
| `002_profiles_policies.sql` | One policy per operation, role-scoped (`TO authenticated`), `auth.uid()` wrapped in a subquery, `WITH CHECK` on writes |
| `003_function.sql` | `SECURITY DEFINER` function with a fixed, empty `search_path` |

## dynamic-ddl-project — 1 migration, deliberately not analyzable

Expected result: **3 critical** plus **1 scan warning** (exit 1; `--strict`
exits 2 because the scan is incomplete, not because of the findings).

| Migration | Demonstrates | Findings against the final state |
| --- | --- | --- |
| `001_dynamic_rls.sql` | RLS enabled by `DO $$ … EXECUTE format(…) … $$` over a catalog query, which a static fold cannot follow | RLS001 ×2 (critical), RLS004 (critical `share_token`) — **plus a scan warning** naming the block |

The findings here are the honest answer, not a bug: a block that secures every
table and a block that misses one are indistinguishable without running it. The
warning says so out loud instead of presenting the criticals as certain. See
`docs/03_adrs/ADR-0002-dynamic-ddl-and-exposure-premise.md`.

When adding a migration to any of these projects, keep this table in sync and
adjust the expected totals here and in the affected tests.
