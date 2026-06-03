create table public.profiles (
  id uuid primary key,
  bio text
);
alter table public.profiles enable row level security;

-- Two mistakes: no TO clause (runs for every role, including anon) and
-- auth.uid() is not wrapped in a subquery (re-evaluated per row). The UPDATE
-- policy also has no WITH CHECK, so it does not constrain new row values.
create policy "profiles_update"
  on public.profiles
  for update
  using (auth.uid() = id);
