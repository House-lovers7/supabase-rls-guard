create table public.posts (
  id bigint generated always as identity primary key,
  body text
);
alter table public.posts enable row level security;

-- Dangerous: a permissive policy with USING (true) for anon lets anyone do
-- anything, defeating the point of RLS. FOR ALL with no WITH CHECK is also wrong.
create policy "posts_all"
  on public.posts
  for all
  to anon
  using (true);
