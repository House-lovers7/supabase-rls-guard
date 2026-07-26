-- Synthetic example: RLS applied by generated DDL, which no static analyzer can follow.
-- Tables are created in the clear…

create table public.documents (
  id uuid primary key,
  owner_id uuid not null,
  body text
);

create table public.document_shares (
  id uuid primary key,
  document_id uuid not null references public.documents (id),
  share_token text not null
);

-- …and then secured by a loop whose target list only exists at run time.
-- The scanner reports this as an incomplete scan rather than pretending the
-- tables above are unprotected with full confidence.
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end;
$$;
