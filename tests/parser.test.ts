import { describe, expect, it } from 'vitest'
import { splitStatements } from '../src/parser/splitter.js'
import { analyze, hasRule } from './helpers.js'

describe('splitStatements', () => {
  it('does not split on semicolons inside dollar-quoted bodies', () => {
    const sql = `create function f() returns void language plpgsql as $$
begin
  perform 1;
  perform 2;
end;
$$;
select 1;`
    expect(splitStatements(sql)).toHaveLength(2)
  })

  it('ignores semicolons inside line comments and strings', () => {
    const sql = `select 'a; b'; -- a comment with ; in it
select 2;`
    expect(splitStatements(sql)).toHaveLength(2)
  })

  it('handles block comments', () => {
    const sql = '/* drop table x; */ select 1;'
    expect(splitStatements(sql)).toHaveLength(1)
  })
})

describe('regex backend resilience', () => {
  it('detects a policy preceded by multiple comment lines', async () => {
    const sql = `create table public.t (id int);
alter table public.t enable row level security;
-- comment line one
-- comment line two
create policy p on public.t for all to anon using (true);`
    const findings = await analyze(sql, { backend: 'regex' })
    expect(hasRule(findings, 'RLS006')).toBe(true)
  })
})
