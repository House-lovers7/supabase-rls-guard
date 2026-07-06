import { describe, expect, it } from 'vitest'
import { analyze, hasRule, ruleIds } from './helpers.js'

describe('RLS001 rls_disabled_in_public', () => {
  it('fires for a public table without RLS', async () => {
    expect(hasRule(await analyze('create table public.t (id int);'), 'RLS001')).toBe(true)
  })
  it('does not fire once RLS is enabled', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security;',
    )
    expect(hasRule(f, 'RLS001')).toBe(false)
  })
  it('does not fire for tables outside the exposed schemas', async () => {
    expect(hasRule(await analyze('create table private.t (id int);'), 'RLS001')).toBe(false)
  })
  it('respects the publicTables allowlist', async () => {
    const f = await analyze('create table public.docs (id int);', {
      config: { publicTables: ['public.docs'] },
    })
    expect(hasRule(f, 'RLS001')).toBe(false)
  })
})

describe('RLS002 rls_enabled_no_policy', () => {
  it('fires when RLS is on but no policy exists', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security;',
    )
    expect(hasRule(f, 'RLS002')).toBe(true)
  })
  it('does not fire when a policy exists', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select to authenticated using ((select auth.uid()) = id);',
    )
    expect(hasRule(f, 'RLS002')).toBe(false)
  })
})

describe('RLS003 policy_exists_rls_disabled', () => {
  it('fires when a policy exists but RLS is disabled', async () => {
    const f = await analyze(
      'create table public.t (id int); create policy p on public.t for select to authenticated using ((select auth.uid()) = id);',
    )
    expect(hasRule(f, 'RLS003')).toBe(true)
  })
})

describe('RLS004 sensitive_column_unprotected', () => {
  it('flags a password column as critical', async () => {
    const f = await analyze('create table public.t (id int, password_hash text);')
    const finding = f.find((x) => x.ruleId === 'RLS004')
    expect(finding?.severity).toBe('critical')
  })
  it('flags email as info', async () => {
    const f = await analyze('create table public.t (id int, email text);')
    const finding = f.find((x) => x.ruleId === 'RLS004')
    expect(finding?.severity).toBe('info')
  })
  it('does not fire when RLS protects the table', async () => {
    const f = await analyze(
      'create table public.t (id int, password_hash text); alter table public.t enable row level security;',
    )
    expect(hasRule(f, 'RLS004')).toBe(false)
  })
  it('does not match substrings like tokenized_at', async () => {
    const f = await analyze('create table public.t (id int, tokenized_at timestamptz);')
    expect(hasRule(f, 'RLS004')).toBe(false)
  })
})

describe('RLS005 broad_grant_to_anon', () => {
  it('fires for grant to anon on an unprotected table', async () => {
    const f = await analyze('create table public.t (id int); grant all on public.t to anon;')
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
  it('does not fire when RLS is enabled', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; grant all on public.t to anon;',
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
  it('fires for GRANT ... ON ALL TABLES IN SCHEMA ... TO anon on an unprotected table', async () => {
    const f = await analyze(
      'create table public.t (id int); grant select on all tables in schema public to anon;',
    )
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
  it('GRANT ON ALL TABLES is found by both parser backends', async () => {
    const sql =
      'create table public.t (id int); grant select on all tables in schema public to anon;'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS005')).toBe(true)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS005')).toBe(true)
  })
})

describe('RLS006 rls_policy_always_true', () => {
  it('is critical for anon USING (true)', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select to anon using (true);',
    )
    expect(f.find((x) => x.ruleId === 'RLS006')?.severity).toBe('critical')
  })
  it('is a warning for authenticated USING (true)', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select to authenticated using (true);',
    )
    expect(f.find((x) => x.ruleId === 'RLS006')?.severity).toBe('warning')
  })
  it('does not fire for a restrictive always-true policy', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t as restrictive for select to anon using (true);',
    )
    expect(hasRule(f, 'RLS006')).toBe(false)
  })
  it('does NOT flag an INSERT policy with WITH CHECK (true) (public submission form)', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for insert to anon with check (true);',
    )
    expect(hasRule(f, 'RLS006')).toBe(false)
  })
  it('flags a FOR ALL policy with WITH CHECK (true)', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for all to anon with check (true);',
    )
    expect(hasRule(f, 'RLS006')).toBe(true)
  })
})

describe('RLS007 policy_missing_to_role', () => {
  it('fires when no TO clause is given', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select using ((select auth.uid()) = id);',
    )
    expect(hasRule(f, 'RLS007')).toBe(true)
  })
  it('does not fire with an explicit role', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select to authenticated using ((select auth.uid()) = id);',
    )
    expect(hasRule(f, 'RLS007')).toBe(false)
  })
})

describe('RLS008 auth_rls_initplan', () => {
  it('fires for unwrapped auth.uid()', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select to authenticated using (auth.uid() = id);',
    )
    expect(hasRule(f, 'RLS008')).toBe(true)
  })
  it('does not fire when wrapped in a subquery', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select to authenticated using ((select auth.uid()) = id);',
    )
    expect(hasRule(f, 'RLS008')).toBe(false)
  })
})

describe('RLS009 rls_references_user_metadata', () => {
  it('fires when a policy references user_metadata', async () => {
    const f = await analyze(
      "create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for select to authenticated using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');",
    )
    expect(hasRule(f, 'RLS009')).toBe(true)
  })
})

describe('RLS010 security_definer_view', () => {
  it('fires for a view without security_invoker', async () => {
    expect(hasRule(await analyze('create view public.v as select 1;'), 'RLS010')).toBe(true)
  })
  it('does not fire with security_invoker = on', async () => {
    const f = await analyze('create view public.v with (security_invoker = on) as select 1;')
    expect(hasRule(f, 'RLS010')).toBe(false)
  })
})

describe('RLS011 function_search_path_mutable', () => {
  it('fires for a function without search_path', async () => {
    const f = await analyze(
      'create function public.f() returns int language sql as $$ select 1 $$;',
    )
    expect(hasRule(f, 'RLS011')).toBe(true)
  })
  it('does not fire when search_path is set', async () => {
    const f = await analyze(
      "create function public.f() returns int language sql set search_path = '' as $$ select 1 $$;",
    )
    expect(hasRule(f, 'RLS011')).toBe(false)
  })
})

describe('RLS012 materialized_view_in_api', () => {
  it('fires for a materialized view in an exposed schema', async () => {
    const sql = 'create materialized view public.mv as select 1;'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS012')).toBe(true)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS012')).toBe(true)
  })
  it('does not fire outside exposed schemas', async () => {
    const sql = 'create materialized view private.mv as select 1;'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS012')).toBe(false)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS012')).toBe(false)
  })
  it('respects the publicTables allowlist', async () => {
    const sql = 'create materialized view public.mv as select 1;'
    const config = { publicTables: ['public.mv'] }
    expect(hasRule(await analyze(sql, { backend: 'libpg', config }), 'RLS012')).toBe(false)
    expect(hasRule(await analyze(sql, { backend: 'regex', config }), 'RLS012')).toBe(false)
  })
  it('does not fire after the materialized view is dropped', async () => {
    const sql = 'create materialized view public.mv as select 1; drop materialized view public.mv;'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS012')).toBe(false)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS012')).toBe(false)
  })
})

describe('RLS014 foreign_table_in_api', () => {
  it('fires for a foreign table in an exposed schema', async () => {
    const sql = 'create foreign table public.ft (id int) server remote;'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS014')).toBe(true)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS014')).toBe(true)
  })
  it('does not fire outside exposed schemas', async () => {
    const sql = 'create foreign table private.ft (id int) server remote;'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS014')).toBe(false)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS014')).toBe(false)
  })
  it('respects the publicTables allowlist', async () => {
    const sql = 'create foreign table public.ft (id int) server remote;'
    const config = { publicTables: ['public.ft'] }
    expect(hasRule(await analyze(sql, { backend: 'libpg', config }), 'RLS014')).toBe(false)
    expect(hasRule(await analyze(sql, { backend: 'regex', config }), 'RLS014')).toBe(false)
  })
  it('does not fire after the foreign table is dropped', async () => {
    const sql =
      'create foreign table public.ft (id int) server remote; drop foreign table public.ft;'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS014')).toBe(false)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS014')).toBe(false)
  })
})

describe('RLS013 update_policy_missing_with_check', () => {
  it('fires for an UPDATE policy with USING but no WITH CHECK', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for update to authenticated using ((select auth.uid()) = id);',
    )
    expect(hasRule(f, 'RLS013')).toBe(true)
  })
  it('does not fire when WITH CHECK is present', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; create policy p on public.t for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);',
    )
    expect(hasRule(f, 'RLS013')).toBe(false)
  })
})

describe('RLS017 multiple_permissive_policies', () => {
  const setup =
    'create table public.t (id int, owner_id uuid); alter table public.t enable row level security;'

  it('fires for two permissive policies on the same role and command', async () => {
    const f = await analyze(
      `${setup} create policy a on public.t for select to authenticated using ((select auth.uid()) = id); create policy b on public.t for select to authenticated using ((select auth.uid()) = owner_id);`,
    )
    expect(hasRule(f, 'RLS017')).toBe(true)
  })
  it('does not fire when policies cover different commands', async () => {
    const f = await analyze(
      `${setup} create policy a on public.t for select to authenticated using ((select auth.uid()) = id); create policy b on public.t for insert to authenticated with check ((select auth.uid()) = id);`,
    )
    expect(hasRule(f, 'RLS017')).toBe(false)
  })
  it('does not fire for a single policy', async () => {
    const f = await analyze(
      `${setup} create policy a on public.t for select to authenticated using ((select auth.uid()) = id);`,
    )
    expect(hasRule(f, 'RLS017')).toBe(false)
  })
  it('reports two FOR ALL policies once, not once per command', async () => {
    const f = await analyze(
      `${setup} create policy a on public.t for all to authenticated using ((select auth.uid()) = id); create policy b on public.t for all to authenticated using ((select auth.uid()) = owner_id);`,
    )
    expect(f.filter((x) => x.ruleId === 'RLS017')).toHaveLength(1)
  })
})

describe('RLS018 disable_rls_in_migration', () => {
  it('fires when a migration disables RLS', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t enable row level security; alter table public.t disable row level security;',
    )
    expect(hasRule(f, 'RLS018')).toBe(true)
  })
})

describe('RLS015 auth_users_exposed', () => {
  it('fires for a view selecting from auth.users in an exposed schema', async () => {
    const f = await analyze('create view public.v as select id, email from auth.users;')
    expect(hasRule(f, 'RLS015')).toBe(true)
  })
  it('does not fire for a view that does not touch auth.users', async () => {
    const f = await analyze(
      'create table public.t (id int); create view public.v as select id from public.t;',
    )
    expect(hasRule(f, 'RLS015')).toBe(false)
  })
})

describe('RLS016 rls_uses_auth_role', () => {
  const setup = 'create table public.t (id int); alter table public.t enable row level security;'
  it('fires (info) when a policy gates on auth.role() in its predicate', async () => {
    const f = await analyze(
      `${setup} create policy p on public.t for select using (auth.role() = 'authenticated');`,
    )
    expect(f.find((x) => x.ruleId === 'RLS016')?.severity).toBe('info')
  })
  it('does not fire when the policy uses auth.uid() instead', async () => {
    const f = await analyze(
      `${setup} create policy p on public.t for select to authenticated using ((select auth.uid()) = id);`,
    )
    expect(hasRule(f, 'RLS016')).toBe(false)
  })
})

describe('ALTER POLICY (#8)', () => {
  const setup = 'create table public.t (id int); alter table public.t enable row level security;'
  it('detects loosening a secure policy to USING (true)', async () => {
    const f = await analyze(
      `${setup} create policy p on public.t for select to authenticated using ((select auth.uid()) = id); alter policy p on public.t using (true);`,
    )
    expect(hasRule(f, 'RLS006')).toBe(true)
  })
  it('clears the finding when a policy is tightened from USING (true)', async () => {
    const f = await analyze(
      `${setup} create policy p on public.t for select to authenticated using (true); alter policy p on public.t using ((select auth.uid()) = id);`,
    )
    expect(hasRule(f, 'RLS006')).toBe(false)
  })
})

describe('REVOKE (#9)', () => {
  it('clears an RLS005 finding when the grant is fully revoked', async () => {
    const f = await analyze(
      'create table public.t (id int); grant select on public.t to anon; revoke select on public.t from anon;',
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
  it('keeps flagging when a revoke does not fully cover the grant', async () => {
    const f = await analyze(
      'create table public.t (id int); grant all on public.t to anon; revoke insert on public.t from anon;',
    )
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
  it('clears a schema-wide grant when it is revoked', async () => {
    const f = await analyze(
      'create table public.t (id int); grant select on all tables in schema public to anon; revoke select on all tables in schema public from anon;',
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
})

describe('ALTER TABLE ADD COLUMN (#6)', () => {
  it('tracks a sensitive column added in a later migration (RLS004)', async () => {
    const f = await analyze(
      'create table public.t (id int); alter table public.t add column password text;',
    )
    expect(hasRule(f, 'RLS004')).toBe(true)
  })
  it('is handled by both parser backends', async () => {
    const sql = 'create table public.t (id int); alter table public.t add column token text;'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS004')).toBe(true)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS004')).toBe(true)
  })
})

describe('#18 ALTER POLICY ... RENAME TO', () => {
  const sql =
    'create table public.t (id uuid, user_id uuid); alter table public.t enable row level security; create policy p on public.t for select using (true); alter policy p on public.t rename to q;'
  it('keeps RLS006 critical under the regex backend (rename is not a roles change)', async () => {
    const f = await analyze(sql, { backend: 'regex' })
    expect(f.find((x) => x.ruleId === 'RLS006')?.severity).toBe('critical')
    expect(hasRule(f, 'RLS007')).toBe(true)
  })
  it('produces identical rule sets under both backends', async () => {
    const a = new Set(ruleIds(await analyze(sql, { backend: 'libpg' })))
    const b = new Set(ruleIds(await analyze(sql, { backend: 'regex' })))
    expect([...a].sort()).toEqual([...b].sort())
  })
})

describe('#21 GRANT/REVOKE semantics', () => {
  it('partial REVOKE subtracts only the named grantee (libpg)', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant select on public.t to anon, authenticated; revoke select on public.t from anon;',
      { backend: 'libpg' },
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
  it('partial REVOKE subtracts only the named privilege (libpg)', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant select, insert on public.t to anon; revoke insert on public.t from anon;',
      { backend: 'libpg' },
    )
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
  it('expands ALL PRIVILEGES so revoked data privileges clear RLS005 (libpg)', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant all privileges on public.t to anon; revoke select, insert, update, delete on public.t from anon;',
      { backend: 'libpg' },
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
  it('cross-level: schema-wide REVOKE ALL clears a table-level grant', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant select on public.t to anon; revoke all on all tables in schema public from anon;',
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
  it('cross-level: schema-wide REVOKE subtracts one table-level privilege (libpg)', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant select, insert on public.t to anon; revoke insert on all tables in schema public from anon;',
      { backend: 'libpg' },
    )
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
  it('cross-level: table-level REVOKE clears an expanded schema-wide grant', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant select on all tables in schema public to anon; revoke select on public.t from anon;',
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
  it('cross-level: table-level REVOKE subtracts from schema-wide ALL PRIVILEGES (libpg)', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant all privileges on all tables in schema public to anon; revoke select, insert, update, delete on public.t from anon;',
      { backend: 'libpg' },
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
  it('schema-wide GRANT does NOT apply to tables created after it', async () => {
    const f = await analyze(
      'grant select on all tables in schema public to anon; create table public.posts (id uuid);',
    )
    expect(hasRule(f, 'RLS005')).toBe(false) // RLS001 still fires for the table itself
    expect(hasRule(f, 'RLS001')).toBe(true)
  })
  it('ALTER DEFAULT PRIVILEGES applies to tables created after it (RLS005 fires)', async () => {
    const f = await analyze(
      'alter default privileges in schema public grant select on tables to anon; create table public.posts (id uuid);',
    )
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
  it('ALTER DEFAULT PRIVILEGES does not affect tables created before it', async () => {
    const f = await analyze(
      'create table public.posts (id uuid); alter default privileges in schema public grant select on tables to anon;',
    )
    expect(hasRule(f, 'RLS005')).toBe(false)
  })
  it('ADP is detected by both parser backends', async () => {
    const sql =
      'alter default privileges in schema public grant select on tables to anon; create table public.posts (id uuid);'
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS005')).toBe(true)
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS005')).toBe(true)
  })
})

describe('#22 DROP VIEW / DROP FUNCTION', () => {
  it('a dropped view no longer fires RLS010/RLS015', async () => {
    const f = await analyze(
      'create view public.v as select email from auth.users; drop view public.v;',
    )
    expect(hasRule(f, 'RLS010')).toBe(false)
    expect(hasRule(f, 'RLS015')).toBe(false)
  })
  it('a dropped function no longer fires RLS011', async () => {
    const f = await analyze(
      'create function public.f() returns int language sql as $$ select 1 $$; drop function public.f();',
    )
    expect(hasRule(f, 'RLS011')).toBe(false)
  })
  it('drop handling matches across backends', async () => {
    const sql =
      'create view public.v as select email from auth.users; drop view if exists public.v;'
    expect(ruleIds(await analyze(sql, { backend: 'libpg' })).sort()).toEqual(
      ruleIds(await analyze(sql, { backend: 'regex' })).sort(),
    )
  })
})

describe('#23 RLS017 public-role overlap', () => {
  it('fires when a TO-less (public) policy overlaps a role-specific one', async () => {
    const f = await analyze(
      'create table public.t (id uuid, user_id uuid); alter table public.t enable row level security; create policy a on public.t for select using ((select auth.uid()) = user_id); create policy b on public.t for select to authenticated using ((select auth.uid()) = user_id);',
    )
    expect(hasRule(f, 'RLS017')).toBe(true)
  })
})

describe('#24 REVOKE GRANT OPTION FOR', () => {
  const sql =
    'create table public.t (id uuid); grant select on public.t to anon; revoke grant option for select on public.t from anon;'
  it('keeps the underlying grant — RLS005 still fires (libpg)', async () => {
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS005')).toBe(true)
  })
  it('leaves other privileges untouched when revoking only a grant option (libpg)', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant select, insert on public.t to anon with grant option; revoke grant option for insert on public.t from anon;',
      { backend: 'libpg' },
    )
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
  it('keeps the underlying grant — RLS005 still fires (regex)', async () => {
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS005')).toBe(true)
  })
})

describe('#25 GRANT ... TO PUBLIC', () => {
  it('fires RLS005 (PUBLIC includes anon)', async () => {
    const f = await analyze('create table public.t (id uuid); grant select on public.t to public;')
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
  it('fires at schema level too', async () => {
    const f = await analyze(
      'create table public.t (id uuid); grant select on all tables in schema public to public;',
    )
    expect(hasRule(f, 'RLS005')).toBe(true)
  })
})

describe('#26 regex auth-fn heuristics', () => {
  it('a closed earlier subquery does not mark a later call as wrapped (RLS008 fires)', async () => {
    const sql =
      'create table public.t (id uuid, user_id uuid, team_id uuid); alter table public.t enable row level security; create policy p on public.t for select to authenticated using (team_id in (select team_id from public.memberships) and auth.uid() = user_id);'
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS008')).toBe(true)
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS008')).toBe(true)
  })
  it('my_auth.role_check is not mistaken for auth.role (no RLS008/RLS016)', async () => {
    const sql =
      'create table public.t (id uuid, user_id uuid); alter table public.t enable row level security; create policy p on public.t for select to authenticated using (my_auth.role_check(user_id));'
    const f = await analyze(sql, { backend: 'regex' })
    expect(hasRule(f, 'RLS008')).toBe(false)
    expect(hasRule(f, 'RLS016')).toBe(false)
  })
})

describe('#27 regex ADD COLUMN forms', () => {
  it('multi-command ALTER TABLE tracks every added column', async () => {
    const sql =
      'create table public.t (id int); alter table public.t add column password text, add column ssn text;'
    const f = await analyze(sql, { backend: 'regex' })
    const targets = f.filter((x) => x.ruleId === 'RLS004').map((x) => x.target)
    expect(targets).toContain('public.t.password')
    expect(targets).toContain('public.t.ssn')
  })
  it('ADD without the COLUMN keyword is tracked', async () => {
    const sql = 'create table public.t (id int); alter table public.t add api_key text;'
    expect(hasRule(await analyze(sql, { backend: 'regex' }), 'RLS004')).toBe(true)
    expect(hasRule(await analyze(sql, { backend: 'libpg' }), 'RLS004')).toBe(true)
  })
})

describe('config', () => {
  it('disables a rule via config', async () => {
    const f = await analyze('create table public.t (id int);', {
      config: { disabledRules: new Set(['RLS001']) },
    })
    expect(hasRule(f, 'RLS001')).toBe(false)
  })
  it('overrides severity via config', async () => {
    const f = await analyze('create table public.t (id int);', {
      config: { severity: { RLS001: 'warning' } },
    })
    expect(f.find((x) => x.ruleId === 'RLS001')?.severity).toBe('warning')
  })
})

describe('parser parity', () => {
  it('libpg and regex backends find the same rules on the unsafe sample', async () => {
    const sql =
      'create table public.t (id int, token text); create policy p on public.t for all to anon using (true);'
    const a = new Set(ruleIds(await analyze(sql, { backend: 'libpg' })))
    const b = new Set(ruleIds(await analyze(sql, { backend: 'regex' })))
    expect([...a].sort()).toEqual([...b].sort())
  })
})
