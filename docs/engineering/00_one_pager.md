<!-- generated-by: scripts/generate_engineering_docs.py -->
# Supabase RLS Guard — One Pager / オンボーディング概要

> 生成日: 2026-07-15 / 対象: `supabase-rls-guard` / 確度: [高]
> 実装・manifest・既存資料の静的棚卸しに基づく。外部サービスの稼働状態と本番構成は未検証。

## コンセプト

A tiny, zero-DB CLI that statically scans Supabase migration SQL for dangerous Row Level Security mistakes before you ship.

## 誰の何を解くか

- 対象領域: セキュリティ/認証/監査/決済
- 想定利用者: 開発/セキュリティ/運用担当
- 価値仮説: 設定/ログ/リクエスト/差分を検査し、危険差分・承認・監査証跡・決済境界を可視化。

## 現在地

| 項目 | 観測結果 |
|---|---|
| 技術スタック | TypeScript, Node.js |
| API | 0 endpoint signal |
| データモデル | 9 unique entity signal |
| 画面 | 0 route/screen signal |
| 実行基盤 | config (`.github/workflows/ci.yml`), config (`.github/workflows/dependency-review.yml`), config (`.github/workflows/release.yml`), config (`.github/workflows/self-scan.yml`) |
| package / module | 2 component signal |
| tests | 10 file signal |

## ソースマップ

| Component | Path | 責務 |
|---|---|---|
| `supabase-rls-guard` | `.` | 責務は実装と既存READMEを確認 |
| `src` | `src` | 中核実装。詳細は配下moduleを参照 |

## 最初に使うコマンド

| 目的 | Command |
|---|---|
| `dev` | `npm run dev  # tsdown --watch` |
| `build` | `npm run build  # tsdown` |
| `typecheck` | `npm run typecheck  # tsc --noEmit` |
| `lint` | `npm run lint  # biome check .` |
| `test` | `npm run test  # vitest run` |
| `format` | `npm run format  # biome format --write .` |

## 変更箇所の入口

| 変更対象 | 最初に読むpath | 同時に確認するもの |
|---|---|---|
| データモデル | `examples/unsafe-project/supabase/migrations/001_create_users.sql` | migration、制約、seed、API型 |
| 実行・配備 | `.github/workflows/ci.yml` | 環境変数、service依存、rollback |
| 回帰検査 | `vitest.config.ts` | 変更対象に近いtestと全体check |

## 引継ぎ時の未解決ギャップ

3件の P1 gap は 2026-07-19 に解消済み（下表）。未解決の gap は現在なし。

| Priority | Requirement | 状態・理由 | Evidence |
|---|---|---|---|
| P1 | `entrypoints` | resolved: CLI + library の公開面・責務・ユースケースを手動検証で明文化。 | `docs/engineering/04_api.md` |
| P1 | `migration_readme_drift` | resolved: 全14 migration（unsafe 11 + safe 3）の適用順・意図・期待 finding を対応表化。 | `examples/README.md` |
| P1 | `rollback` | resolved: npm publish 版の実行可能な rollback 手順（deprecate + patch 版）を定義。 | `docs/engineering/05_nfr_slo.md` |

## スコープ境界

- [高] productionの稼働、外部provider設定、secret値は未確認。
- [高] API・DB・画面が未検出の場合は推測せず、実装入口の追加を課題として残す。
- [中] 初回変更前に `07_traceability.md` の根拠と未確認事項を確認する。
