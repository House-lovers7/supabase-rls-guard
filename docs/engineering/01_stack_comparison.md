<!-- generated-by: scripts/generate_engineering_docs.py -->
# Supabase RLS Guard — 技術スタック比較

> 生成日: 2026-07-15 / 対象: `supabase-rls-guard` / 確度: [高]
> 実装・manifest・既存資料の静的棚卸しに基づく。外部サービスの稼働状態と本番構成は未検証。

## 観測された採用スタック

TypeScript ^6.0.3, Node.js

## Package / workspace

| Package | Manifest |
|---|---|
| `supabase-rls-guard` | `package.json` |

## トレードオフ

| 対象 | 現在 | 比較候補 | 現在案の利点 | 注意点 |
|---|---|---|---|---|
| 資産形態 | 現在のファイル構成 | runtime新設 | 移行を伴わず正典を保持 | 実行manifestがないため技術比較は未成立 |

> [中] 比較候補は現行実装を理解するための対照であり、移行提案ではない。当時の採用理由は既存ADRがあればそちらを正典とする。

## 判断を更新する条件

- manifest: `package.json`
- quality config: `tsconfig.json`, `biome.json`, `vitest.config.ts`, `.github/workflows/release.yml`, `.github/workflows/dependency-review.yml`, `.github/workflows/self-scan.yml`, `.github/workflows/ci.yml`
- framework更新時はlockfile、build、typecheck、主要test、runtime smokeを同じ変更で確認する。
