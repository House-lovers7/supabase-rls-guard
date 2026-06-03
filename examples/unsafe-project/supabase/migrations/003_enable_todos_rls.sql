-- Enables RLS for `todos` (created in 002) and adds a correct, scoped policy.
-- No findings expected for `todos`.
alter table public.todos enable row level security;

create policy "todos_select_own"
  on public.todos
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
