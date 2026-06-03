-- A view without security_invoker runs with the creator's privileges and
-- bypasses the querying user's RLS.
create view public.user_emails as
  select id, email from public.users;

-- A function with a mutable search_path can be hijacked via object resolution.
create function public.first_user_email()
returns text
language sql
as $$ select email from public.users limit 1 $$;
