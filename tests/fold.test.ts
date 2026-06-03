import { describe, expect, it } from 'vitest'
import { foldStatements, tableKey } from '../src/core/schema-state.js'
import type { Statement } from '../src/core/types.js'
import { parseSql } from '../src/parser/index.js'

async function statementsOf(...sqls: string[]): Promise<Statement[]> {
  const all: Statement[] = []
  for (const [i, sql] of sqls.entries()) {
    const { statements } = await parseSql(sql, `migration_${i}.sql`, 'auto')
    all.push(...statements)
  }
  return all
}

describe('schema folding across migrations', () => {
  it('treats RLS enabled in a later migration as correct (no false positive)', async () => {
    const stmts = await statementsOf(
      'create table public.todos (id int);',
      'alter table public.todos enable row level security;',
    )
    const state = foldStatements(stmts, ['public'])
    expect(state.tables.get(tableKey('public', 'todos'))?.rlsEnabled).toBe(true)
  })

  it('records a disable event and flips rlsEnabled back to false', async () => {
    const stmts = await statementsOf(
      'create table public.t (id int); alter table public.t enable row level security;',
      'alter table public.t disable row level security;',
    )
    const state = foldStatements(stmts, ['public'])
    expect(state.tables.get(tableKey('public', 't'))?.rlsEnabled).toBe(false)
    expect(state.rlsDisabledEvents).toHaveLength(1)
  })

  it('marks dropped tables', async () => {
    const stmts = await statementsOf('create table public.t (id int); drop table public.t;')
    const state = foldStatements(stmts, ['public'])
    expect(state.tables.get(tableKey('public', 't'))?.dropped).toBe(true)
  })

  it('does not duplicate a table created with IF NOT EXISTS', async () => {
    const stmts = await statementsOf(
      'create table public.t (id int, a text);',
      'create table if not exists public.t (id int);',
    )
    const state = foldStatements(stmts, ['public'])
    expect(state.tables.size).toBe(1)
    expect(state.tables.get(tableKey('public', 't'))?.columns).toHaveLength(2)
  })

  it('attaches policies to the right table and removes them on drop policy', async () => {
    const stmts = await statementsOf(
      'create table public.t (id int); alter table public.t enable row level security;',
      'create policy p on public.t for select to authenticated using (true);',
      'drop policy p on public.t;',
    )
    const state = foldStatements(stmts, ['public'])
    expect(state.tables.get(tableKey('public', 't'))?.policies).toHaveLength(0)
  })
})
