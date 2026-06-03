create table public.settings (
  id uuid primary key,
  key text not null,
  value text
);
-- RLS is enabled but no policy is ever added, so every API read returns nothing.
-- Usually a sign someone forgot to write the policies.
alter table public.settings enable row level security;
