import { describe, expect, it } from 'vitest'
import { lexSql, splitStatements } from '../src/parser/splitter.js'
import { analyze, hasRule } from './helpers.js'

/** The text between the tags of each dollar-quoted body found in `sql`. */
function bodies(sql: string): string[] {
  return lexSql(sql).dollarBodies.map((b) => sql.slice(b.start, b.end))
}

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

describe('lexSql dollar-quoted bodies', () => {
  it('records the body of $$ and $tag$ blocks, excluding the tags', () => {
    const sql = `do $$ begin perform 1; end $$;
create function f() returns void language plpgsql as $body$ select 2; $body$;`
    expect(bodies(sql)).toEqual([' begin perform 1; end ', ' select 2; '])
  })

  it('does not treat $$ inside a string or a comment as an opening tag', () => {
    expect(bodies("select 'cost: $$$$';")).toEqual([])
    expect(bodies('-- $$ not a body $$\nselect 1;')).toEqual([])
    expect(bodies('/* $$ not a body $$ */ select 1;')).toEqual([])
  })

  it('treats an unterminated body as running to the end of the file', () => {
    expect(bodies('do $$ begin perform 1;')).toEqual([' begin perform 1;'])
  })

  it('leaves statement splitting unchanged', () => {
    const sql = 'do $$ begin perform 1; end $$;\nselect 1;'
    expect(lexSql(sql).statements).toEqual(splitStatements(sql))
    expect(splitStatements(sql)).toHaveLength(2)
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
