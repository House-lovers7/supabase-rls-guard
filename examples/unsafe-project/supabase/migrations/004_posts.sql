create table public.posts (
  id bigint generated always as identity primary key,
  body text
);
alter table public.posts enable row level security;

-- Dangerous: a permissive policy with USING (true) for anon lets anyone read,
-- update, and delete every row, defeating the point of RLS.
create policy "posts_all"
  on public.posts
  for all
  to anon
  using (true);
