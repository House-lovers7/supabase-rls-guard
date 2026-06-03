-- The AI assistant generated this table but forgot Row Level Security entirely.
-- Anyone with the anon/publishable key can read every row, including password hashes.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);
