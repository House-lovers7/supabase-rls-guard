# Rules

Supabase RLS Guard ships 13 rules. Where a rule corresponds to a check in
Supabase's official [Splinter](https://github.com/supabase/splinter) linter, the
Splinter code is noted so you can cross-reference the dashboard advisor.

By default, only **Critical** findings cause a non-zero exit. Use `--strict` (or
`failOn` in config) to also gate on warnings. Any rule can be disabled or
re-leveled via config or inline comments.

Run `npx supabase-rls-guard --list-rules` for the live list.

---

### RLS001 · `rls_disabled_in_public` · Critical · Splinter 0013

A table in an API-exposed schema (default `public`) has no RLS enabled. Anyone
with the anon/publishable key can read and write every row.

```sql
-- ✗ flagged
create table public.users (id uuid primary key, email text);

-- ✓ fix
alter table public.users enable row level security;
```

### RLS002 · `rls_enabled_no_policy` · Warning · Splinter 0008

RLS is enabled but no policy exists, so every API request returns zero rows. Safe
(fail-closed) but usually means the policies were forgotten.

```sql
alter table public.todos enable row level security;
create policy "todos_select_own" on public.todos
  for select to authenticated using ((select auth.uid()) = user_id);
```

### RLS003 · `policy_exists_rls_disabled` · Critical · Splinter 0007

A policy is defined, but RLS was never enabled on the table — so the policy does
nothing and the table is fully exposed. A classic false sense of security.

```sql
-- the policy below is inert until you run:
alter table public.api_keys enable row level security;
```

### RLS004 · `sensitive_column_unprotected` · Warning / Info · Splinter 0023

A column whose name looks sensitive (`password`, `token`, `ssn`, `credit_card`,
…) lives on a table that has **no RLS**. Critical-tier names (passwords, tokens)
report as Warning; `email`/`phone` report as Info. Only fires when the table is
unprotected, so properly-secured tables never trip it. Extend the keyword lists
via `sensitiveColumns` in config.

### RLS005 · `broad_grant_to_anon` · Critical

An explicit `GRANT … TO anon` on a table that has no RLS hands unauthenticated
users direct access.

```sql
-- ✗ flagged (no RLS on public.public_notes)
grant all on public.public_notes to anon;
```

### RLS006 · `rls_policy_always_true` · Critical / Warning · Splinter 0024

A permissive policy with an always-true predicate (`USING (true)`,
`WITH CHECK (true)`, `1 = 1`). It grants unrestricted access and defeats RLS.
Critical when it targets `anon`/`public`, Warning otherwise. Restrictive
always-true policies are harmless and not flagged.

`USING (true)` is evaluated for `SELECT`/`UPDATE`/`DELETE`/`ALL`; a
`WITH CHECK (true)` on `UPDATE`/`ALL` is also flagged. An **`INSERT` policy with
`WITH CHECK (true)` is intentionally NOT flagged** — that is the standard
"anyone can submit" pattern (e.g. a public contact form), which only permits
inserting new rows, not reading or modifying existing ones.

### RLS007 · `policy_missing_to_role` · Warning

A policy with no `TO` clause (or `TO public`) applies to every role — including
`anon` — and is evaluated on every request. Always scope policies with a role.

```sql
create policy "p" on public.t for select
  to authenticated using ((select auth.uid()) = id);
```

### RLS008 · `auth_rls_initplan` · Warning · Splinter 0003

`auth.uid()` / `auth.jwt()` / `current_setting()` called directly in a policy is
re-evaluated for **every row**. Wrap it in a subquery so Postgres evaluates it
once per statement (Supabase benchmarks ~95% faster on large tables).

```sql
-- ✗  using (auth.uid() = user_id)
-- ✓  using ((select auth.uid()) = user_id)
```

### RLS009 · `rls_references_user_metadata` · Critical · Splinter 0015

A policy reads `user_metadata` / `raw_user_meta_data`. End users can edit these
via `supabase.auth.updateUser({ data: { … } })` with no server validation, so any
access control built on them is trivially bypassable privilege escalation. Use
`app_metadata` or a dedicated roles table instead.

### RLS010 · `security_definer_view` · Critical · Splinter 0010

A view in an exposed schema without `security_invoker = on` runs with the
creator's privileges and bypasses the querying user's RLS.

```sql
alter view public.user_emails set (security_invoker = on);
```

### RLS011 · `function_search_path_mutable` · Warning · Splinter 0011

A function without a fixed `search_path` can be hijacked via object resolution
(especially when `SECURITY DEFINER`).

```sql
create function public.f() returns void language plpgsql
  set search_path = '' as $$ … $$;
```

### RLS013 · `update_policy_missing_with_check` · Info

An `UPDATE` (or `FOR ALL`) policy with `USING` but no `WITH CHECK`. This is
**usually safe**: when `WITH CHECK` is omitted, PostgreSQL reuses the `USING`
expression as the new-row check, so the common ownership pattern
(`USING ((select auth.uid()) = user_id)`) already prevents a user from
reassigning a row to someone else. The lint is an informational nudge: add an
explicit `WITH CHECK` only when the write constraint should differ from the read
constraint.

### RLS018 · `disable_rls_in_migration` · Warning

A migration runs `ALTER TABLE … DISABLE ROW LEVEL SECURITY`. Shipping a disable
is a red flag; make sure it is intentional.

---

## What this tool does *not* check

Some Splinter lints require a live database's catalog/statistics and cannot be
determined from migration text alone. These are intentionally out of scope:
unused/duplicate indexes, table bloat, extension versions, GraphQL exposure,
storage bucket settings, and resolved `EXECUTE` grants. Use the Supabase
dashboard advisor for those after deploy.

## Tuning false positives

- `publicTables` — allowlist tables that are intentionally world-readable.
- `exposedSchemas` — change which schemas are considered API-exposed (default
  `["public"]`). Tables in non-exposed schemas never trigger RLS001/006.
- `disabledRules` / `severity` — turn rules off or re-level them.
- Inline `-- rls-guard-disable-next-line RLS0NN` comments for one-off exceptions.
