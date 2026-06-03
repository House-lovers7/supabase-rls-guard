-- `todos` is created here, but RLS is enabled and a policy added in 003.
-- This is CORRECT and supabase-rls-guard must NOT flag it: the tool folds all
-- migrations together and evaluates the final state, not each file in isolation.
create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id),
  title text not null,
  done boolean not null default false
);
