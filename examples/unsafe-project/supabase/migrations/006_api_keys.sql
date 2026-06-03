create table public.api_keys (
  id uuid primary key,
  user_id uuid,
  token text not null
);

-- A policy is defined, but RLS is never enabled on this table — so the policy
-- does nothing and the table (with its `token` column) is fully exposed.
create policy "api_keys_owner"
  on public.api_keys
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
