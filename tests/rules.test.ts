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
