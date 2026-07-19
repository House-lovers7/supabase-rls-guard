<!-- generated-by: scripts/generate_engineering_docs.py -->
# Supabase RLS Guard — ADR-0001 現行アーキテクチャ選択

> 生成日: 2026-07-15 / 対象: `supabase-rls-guard` / 確度: [高]
> 実装・manifest・既存資料の静的棚卸しに基づく。外部サービスの稼働状態と本番構成は未検証。

## Status

Observed / Accepted as current implementation baseline — 2026-07-15

## Context

`supabase-rls-guard` の後発担当者が、現行コードに埋め込まれた選択を暗黙知のまま変更しないよう、観測できる選択と境界を記録する。当時の会議・採用理由が既存ADRにない項目は「Observed」として扱う。

## Decision

| Decision area | Current decision | Evidence |
|---|---|---|
| Runtime / framework | TypeScript, Node.js | `package.json` |
| Code boundary | supabase-rls-guard | `package/source layout` |
| Data boundary | 9 entitiesをschema/migrationで管理 | `examples/unsafe-project/supabase/migrations/001_create_users.sql, examples/unsafe-project/supabase/migrations/002_create_todos.sql, examples/unsafe-project/supabase/migrations/010_settings.sql, examples/unsafe-project/supabase/migrations/009_grants.sql, examples/unsafe-project/supabase/migrations/005_profiles.sql, examples/unsafe-project/supabase/migrations/011_legacy.sql` |
| Integration boundary | Supabase | `dependency/config filename signal` |
| Quality gate | 10 test files / 7 quality configs | `tsconfig.json, biome.json, vitest.config.ts, .github/workflows/release.yml, .github/workflows/dependency-review.yml, .github/workflows/self-scan.yml` |

- 上表を次の設計変更までのbaselineとする。
- 既存ADRがある場合はそちらを優先し、このADRは索引・現況記録として扱う。
- framework、schema、配備単位、外部providerを変更する際は新しいADRで代替案と移行・rollbackを記録する。

## Consequences

- 変更影響: `src` の境界を跨ぐ変更はAPI/data/UI文書を同時更新する。
- 運用影響: `config (`.github/workflows/ci.yml`), config (`.github/workflows/dependency-review.yml`), config (`.github/workflows/release.yml`), config (`.github/workflows/self-scan.yml`)` の変更は検証とrollback確認が必要。
- 未確認: production設定、動的route、外部console、secret値、当初の比較検討理由。

## Evidence

- `package.json`
- `examples/unsafe-project/supabase/migrations/001_create_users.sql`
- `examples/unsafe-project/supabase/migrations/002_create_todos.sql`
- `examples/unsafe-project/supabase/migrations/010_settings.sql`
- `examples/unsafe-project/supabase/migrations/009_grants.sql`
- `examples/unsafe-project/supabase/migrations/005_profiles.sql`
- `examples/unsafe-project/supabase/migrations/011_legacy.sql`
- `examples/unsafe-project/supabase/migrations/004_posts.sql`
- `examples/unsafe-project/supabase/migrations/006_api_keys.sql`
- `examples/unsafe-project/supabase/migrations/007_admin_flags.sql`
- `examples/safe-project/supabase/migrations/001_profiles.sql`
