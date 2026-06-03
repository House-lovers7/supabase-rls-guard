-- A correctly-secured table: RLS enabled, no sensitive columns exposed.
create table public.profiles (
  id uuid primary key references auth.users (id),
  display_name text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
