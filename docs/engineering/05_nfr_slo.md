<!-- generated-by: scripts/generate_engineering_docs.py -->
# Supabase RLS Guard — 非機能要件・SLO/SLI

> 生成日: 2026-07-15 / 対象: `supabase-rls-guard` / 確度: [高]
> 実装・manifest・既存資料の静的棚卸しに基づく。外部サービスの稼働状態と本番構成は未検証。

## 現在コード化されている品質ゲート

| Gate | Command | 根拠 |
|---|---|---|
| dev | `npm run dev  # tsdown --watch` | manifest script |
| build | `npm run build  # tsdown` | manifest script |
| typecheck | `npm run typecheck  # tsc --noEmit` | manifest script |
| lint | `npm run lint  # biome check .` | manifest script |
| test | `npm run test  # vitest run` | manifest script |
| format | `npm run format  # biome format --write .` | manifest script |

- test files: 10（`vitest.config.ts`, `tests/rules.test.ts`, `tests/helpers.ts`, `tests/parser.test.ts`, `tests/suppressions.test.ts`, `tests/util.test.ts`, `tests/fold.test.ts`, `tests/service-docs.test.ts`, `tests/scan.test.ts`, `tests/cli.test.ts`）
- quality/CI config: `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.github/workflows/release.yml`, `.github/workflows/dependency-review.yml`, `.github/workflows/self-scan.yml`, `.github/workflows/ci.yml`
- security/resilience signal: auth/session (`tests/rules.test.ts`), tenant/RLS (`tests/rules.test.ts`), tenant/RLS (`tests/parser.test.ts`), tenant/RLS (`tests/suppressions.test.ts`), tenant/RLS (`tests/fold.test.ts`), tenant/RLS (`tests/service-docs.test.ts`), auth/session (`tests/scan.test.ts`), tenant/RLS (`tests/scan.test.ts`), tenant/RLS (`tests/cli.test.ts`), tenant/RLS (`examples/unsafe-project/supabase/migrations/001_create_users.sql`), tenant/RLS (`examples/unsafe-project/supabase/migrations/008_views_functions.sql`), tenant/RLS (`examples/unsafe-project/supabase/migrations/002_create_todos.sql`), tenant/RLS (`examples/unsafe-project/supabase/migrations/010_settings.sql`), tenant/RLS (`examples/unsafe-project/supabase/migrations/009_grants.sql`), auth/session (`examples/unsafe-project/supabase/migrations/005_profiles.sql`), tenant/RLS (`examples/unsafe-project/supabase/migrations/005_profiles.sql`), tenant/RLS (`examples/unsafe-project/supabase/migrations/011_legacy.sql`), tenant/RLS (`examples/unsafe-project/supabase/migrations/004_posts.sql`), auth/session (`examples/unsafe-project/supabase/migrations/003_enable_todos_rls.sql`), tenant/RLS (`examples/unsafe-project/supabase/migrations/003_enable_todos_rls.sql`)

## 計測すべきSLI

| Boundary | SLI | 最初の計測根拠 |
|---|---|---|
| Data | migration成功・constraint違反・鮮度/欠損 | `examples/unsafe-project/supabase/migrations/001_create_users.sql` |

## SLOの状態

[高] 合意済みSLO数値はrepository内の実装・資料から確認できていない。任意の99%や2秒を現在要件として記載しない。利用者、運用時間帯、障害コスト、予算を確認してから、上記SLIごとにtarget/window/error budgetを決める。

## 運用境界

- runtime/config: config (`.github/workflows/ci.yml`), config (`.github/workflows/dependency-review.yml`), config (`.github/workflows/release.yml`), config (`.github/workflows/self-scan.yml`)
- required config names: example/sourceから未検出
- 外部integration: Supabase
- rollbackはcode、schema、generated artifact、provider設定を分ける。production操作は人間承認後に行う。

## Rollback手順（手動検証 2026-07-19）

本プロジェクトの「本番」は npm registry に publish された package のみ
（常駐サービス・DB なし）。不具合版 `X.Y.Z` を publish してしまった場合:

1. **利用者向けの即時回避**: 前の正常版への固定を案内する
   （`npm i -D supabase-rls-guard@<prev>` / CI では lockfile を revert）。
2. **不具合版の隔離**: `npm deprecate supabase-rls-guard@X.Y.Z "<理由と代替版>"`
   を実行する（external_send のため人間承認後）。unpublish は registry 側の
   期間・条件制限があるため前提にしない。
3. **修正版の提供**: `git revert` で原因 commit を戻し、patch 版 `X.Y.(Z+1)` を
   通常の release workflow（audit → typecheck → lint → build → test →
   validate:package → publish）で出す。
4. **記録**: CHANGELOG に不具合版・影響・修正版を記載する。

CLI はステートレスなので、利用者側は package 版数を戻す以外の復旧作業を
必要としない（スキーマ・データの rollback は存在しない）。
