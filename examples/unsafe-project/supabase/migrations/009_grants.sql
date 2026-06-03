create table public.public_notes (
  id uuid primary key,
  body text
);

-- Explicitly granting all privileges to anon on a table with no RLS hands
-- unauthenticated users full access.
grant all on public.public_notes to anon;
