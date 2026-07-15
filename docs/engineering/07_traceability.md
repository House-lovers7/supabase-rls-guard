<!-- generated-by: scripts/generate_engineering_docs.py -->
# Supabase RLS Guard — 実装トレーサビリティ

> 生成日: 2026-07-15 / 対象: `supabase-rls-guard` / 確度: [高]
> 実装・manifest・既存資料の静的棚卸しに基づく。外部サービスの稼働状態と本番構成は未検証。

## 根拠台帳

| 種別 | Path | 状態 |
|---|---|---|
| manifest | `package.json` | 静的確認済み |
| package/source | `package.json` | 静的確認済み |
| package/source | `src` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/001_create_users.sql` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/002_create_todos.sql` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/010_settings.sql` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/009_grants.sql` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/005_profiles.sql` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/011_legacy.sql` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/004_posts.sql` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/006_api_keys.sql` | 静的確認済み |
| data | `examples/unsafe-project/supabase/migrations/007_admin_flags.sql` | 静的確認済み |
| data | `examples/safe-project/supabase/migrations/001_profiles.sql` | 静的確認済み |
| test | `vitest.config.ts` | 静的確認済み |
| test | `tests/rules.test.ts` | 静的確認済み |
| test | `tests/helpers.ts` | 静的確認済み |
| test | `tests/parser.test.ts` | 静的確認済み |
| test | `tests/suppressions.test.ts` | 静的確認済み |
| test | `tests/util.test.ts` | 静的確認済み |
| test | `tests/fold.test.ts` | 静的確認済み |
| test | `tests/service-docs.test.ts` | 静的確認済み |
| test | `tests/scan.test.ts` | 静的確認済み |
| test | `tests/cli.test.ts` | 静的確認済み |
| quality/CI | `tsconfig.json` | 静的確認済み |
| quality/CI | `biome.json` | 静的確認済み |
| quality/CI | `vitest.config.ts` | 静的確認済み |
| quality/CI | `.github/workflows/release.yml` | 静的確認済み |
| quality/CI | `.github/workflows/dependency-review.yml` | 静的確認済み |
| quality/CI | `.github/workflows/self-scan.yml` | 静的確認済み |
| quality/CI | `.github/workflows/ci.yml` | 静的確認済み |
| existing docs | `README.md` | 静的確認済み |
| existing docs | `architecture.drawio` | 静的確認済み |
| existing docs | `docs/ci-integration.md` | 静的確認済み |
| existing docs | `docs/known-limitations.md` | 静的確認済み |
| existing docs | `docs/demo.md` | 静的確認済み |
| existing docs | `docs/claude-code-usage.md` | 静的確認済み |
| existing docs | `docs/rules.md` | 静的確認済み |
| existing docs | `docs/codex-usage.md` | 静的確認済み |

## 検出した検証command

- **dev**: `npm run dev  # tsdown --watch`
- **build**: `npm run build  # tsdown`
- **typecheck**: `npm run typecheck  # tsc --noEmit`
- **lint**: `npm run lint  # biome check .`
- **test**: `npm run test  # vitest run`
- **format**: `npm run format  # biome format --write .`

## 設定契約（名前のみ）

- example/sourceから環境変数名を検出できず

値、credential、顧客データは収集していない。設定のrequired/optional、format、取得元は各entrypointとruntimeで確認する。

## 既存文書との関係

- `README.md`
- `architecture.drawio`
- `docs/ci-integration.md`
- `docs/known-limitations.md`
- `docs/demo.md`
- `docs/claude-code-usage.md`
- `docs/rules.md`
- `docs/codex-usage.md`

既存ADR・公式schema・運用runbookがある場合はそれらを正典とし、generated docsは発見用索引として扱う。矛盾を見つけたら実装・正式文書・生成器のどれを直すかをreviewで決める。

## 未確認事項

- 動的route/schema/plugin、external gateway、mobile native設定。
- secret manager、provider console、production runtimeの値と適用version。
- migration適用状態、SLO実績、実データ量、owner/on-call。

## 更新ルール

- route/schema/screen/runtime構成を変更した差分では、対応する文書を同時更新する。
- 生成し直す前に手書き文書を正典へ昇格するか、生成対象外へ分離する。
- このディレクトリの `generated-by` marker付きファイルは本スクリプトで再生成できる。
