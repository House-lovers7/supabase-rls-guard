create table public.legacy_kv (
  id uuid primary key,
  val text
);
alter table public.legacy_kv enable row level security;

-- Someone disabled RLS while debugging and forgot to remove it. The table is
-- now unprotected, and shipping a DISABLE statement is itself a red flag.
alter table public.legacy_kv disable row level security;
