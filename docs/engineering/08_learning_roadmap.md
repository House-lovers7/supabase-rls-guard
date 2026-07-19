<!-- generated-by: scripts/generate_engineering_docs.py -->
# Supabase RLS Guard — 学習・保守ロードマップ

> 生成日: 2026-07-15 / 対象: `supabase-rls-guard` / 確度: [高]
> 実装・manifest・既存資料の静的棚卸しに基づく。外部サービスの稼働状態と本番構成は未検証。

## Day 1: 起動と全体像

1. install候補: `pnpm install --frozen-lockfile`
2. 最初の実行/検査: `npm run dev  # tsdown --watch`
3. `.` を読み、責務は実装と既存READMEを確認の境界を確認
4. `src` を読み、中核実装。詳細は配下moduleを参照の境界を確認

## Day 2–3: 主要契約

- APIがない/未検出であることを確認
- `examples/unsafe-project/supabase/migrations/001_create_users.sql` の 9 entityとmigration順序を確認
- CLI/API/docs入口の成功・失敗フィードバックを確認
- external/config: Supabase / 設定名未検出

## 最初の変更前

- 変更対象に最も近いtest: `vitest.config.ts`, `tests/rules.test.ts`, `tests/helpers.ts`, `tests/parser.test.ts`, `tests/suppressions.test.ts`, `tests/util.test.ts`, `tests/fold.test.ts`, `tests/service-docs.test.ts`, `tests/scan.test.ts`, `tests/cli.test.ts`
- 既存ADR/docs: `README.md`, `architecture.drawio`, `docs/ci-integration.md`, `docs/known-limitations.md`, `docs/demo.md`, `docs/claude-code-usage.md`, `docs/rules.md`, `docs/codex-usage.md`
- runtime: config (`.github/workflows/ci.yml`), config (`.github/workflows/dependency-review.yml`), config (`.github/workflows/release.yml`), config (`.github/workflows/self-scan.yml`)
- `07_traceability.md` の未確認事項をcloseまたはrisk acceptしてから変更する。

## Doneの定義

- build/type/lint/testのうち存在するgateが通る。
- API/data/UI/runtimeの変更に対応する文書とADRを更新する。
- rollback、秘密情報、外部送信、production影響をreviewで明示する。
