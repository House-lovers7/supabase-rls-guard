<!-- generated-by: scripts/generate_engineering_docs.py -->
# Supabase RLS Guard — Engineering Handbook / Start Here

> 生成日: 2026-07-15 / 対象: `supabase-rls-guard` / 確度: [高]
> 実装・manifest・既存資料の静的棚卸しに基づく。外部サービスの稼働状態と本番構成は未検証。

## 60分で把握する

1. コンセプト: A tiny, zero-DB CLI that statically scans Supabase migration SQL for dangerous Row Level Security mistakes before you ship.
2. classification: `active_project` / stack: TypeScript ^6.0.3, Node.js
3. install: `pnpm install --frozen-lockfile`
4. run/check: `npm run dev  # tsdown --watch`, `npm run build  # tsdown`, `npm run typecheck  # tsc --noEmit`, `npm run lint  # biome check .`, `npm run test  # vitest run`
5. entrypoint: entrypoint未検出

## 実装スナップショット

| 項目 | 現在値 | 最初に読むpath |
|---|---:|---|
| package/component | 2 | `.` |
| API | 0 | 未検出 |
| entity | 9 | `examples/unsafe-project/supabase/migrations/001_create_users.sql` |
| screen/entry UI | 0 | 未検出 |
| test files | 10 | `vitest.config.ts` |

## 最初に確認する既存の正典候補

- `README.md`
- `architecture.drawio`
- `docs/ci-integration.md`
- `docs/known-limitations.md`
- `docs/demo.md`
- `docs/claude-code-usage.md`
- `docs/rules.md`
- `docs/codex-usage.md`

既存ADR、OpenAPI、schema、運用runbookがある場合は、下記generated docsより先に読む。

## 引継ぎblocking / partial

| Priority | Requirement | 状態・理由 | Evidence |
|---|---|---|---|
| P1 | `entrypoints` | partial: entrypoint候補はあるが、利用形態・process・責務を実装pathに結び付けた説明が不足。 | `src/index.ts` |
| P1 | `migration_readme_drift` | partial: READMEから 14 migrationを確認できない。適用順と必須性をschema正典で確認。 | `examples/unsafe-project/supabase/migrations/001_create_users.sql` |
| P1 | `rollback` | missing: build/deploy可能だが実行可能なrollback手順がない。生成NFRもrelease前に定義としている。 | `docs/engineering/05_nfr_slo.md` |

## 読む順番

1. [One Pager](./00_one_pager.md)
2. [技術スタック比較](./01_stack_comparison.md)
3. [アーキテクチャ・システム構成](./02_architecture.md)
4. [ADR](./03_adrs/ADR-0001-current-implementation-baseline.md)
5. [API定義](./04_api.md)
6. [データモデル・ER図](./05_data_model.md)
7. [非機能要件・SLO/SLI](./05_nfr_slo.md)
8. [画面設計](./06_screen_design.md)
9. [P50/P90見積り](./06_estimation.md)
10. [実装トレーサビリティ](./07_traceability.md)
11. [学習・保守ロードマップ](./08_learning_roadmap.md)

## 使い方

- generated docsは実装発見用handbook。既存ADR、OpenAPI、schema、runbookがある場合は既存正典を優先する。
- path・数・versionは静的検出した事実。目的やpath由来の責務は `[中]` の推定を含む。
- production、external console、secret値、migration適用状態は未確認。
