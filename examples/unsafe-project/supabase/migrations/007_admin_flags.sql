create table public.admin_flags (
  id uuid primary key,
  user_id uuid
);
alter table public.admin_flags enable row level security;

-- Trusting user_metadata for authorization is privilege escalation: end users
-- can set it themselves via supabase.auth.updateUser({ data: { role: 'admin' } }).
create policy "admin_only"
  on public.admin_flags
  for select
  to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
