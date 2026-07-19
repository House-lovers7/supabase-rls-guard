# 監査報告書（合成サンプル）

> **本書は合成サンプルです。顧客案件ではありません。** 本リポジトリ同梱の
> デモ用プロジェクト `examples/unsafe-project` を対象に、報告書の粒度と形式を
> 事前に確認していただく目的で作成したものであり、
> **有償監査実績を示すものではありません。**

## 1. 概要

- 対象: `examples/unsafe-project/supabase/migrations`（11ファイル）
- 実施期間: 2026-07-19 〜 2026-07-19
- 使用ツール: supabase-rls-guard v0.2.0（パーサーバックエンド: libpg）
- 実施者: （合成サンプルのため省略）

## 2. スキャン完全性

- スキャンしたファイル数: 11
- 解析警告数: 0 件
- 監査未完了の範囲: なし（第4節参照）

## 3. 検出結果と人手判定

ツール出力全体: 11 critical, 6 warning, 3 info（抜粋を以下に示す）。

| # | CLIルールID | 対象 | CLI重大度 | 人手判定 | 根拠 | 推奨対応 |
| - | ----------- | ---- | --------- | -------- | ---- | -------- |
| 1 | RLS001 | public.users | Critical | 真陽性 | RLS 無効のまま API 公開スキーマに存在 | `ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;` の上でポリシーを設計 |
| 2 | RLS004 | public.users.password_hash | Critical | 真陽性 | RLS 無効テーブル上の機微カラム。anon キーで読み出し可能 | #1 の対応に含める。ハッシュ列は API から返さない設計へ |
| 3 | RLS006 | public.posts | Critical | 真陽性 | ポリシー "posts_all" が anon/public に `USING (true)` | `USING ((select auth.uid()) = user_id)` 等の実条件へ置換 |
| 4 | RLS007 | public.profiles | Warning | 真陽性 | ポリシー "profiles_update" に TO 句がなく全ロールに適用 | `TO authenticated` を付与 |
| 5 | RLS008 | public.profiles | Warning | 真陽性 | `auth.uid()` の直呼びで行ごとに再評価 | `(select auth.uid())` にラップ |
| 6 | RLS013 | public.posts | Info | 意図的許容 | UPDATE/ALL ポリシーの WITH CHECK 省略は USING を流用する仕様 | 書き込み条件を読み取りと変えるなら明示 |

（合成サンプルのため抜粋。実案件では検出全件に人手判定を付与して納品する。）

## 4. 監査未完了の範囲

なし（解析警告 0 件。全ファイルが libpg バックエンドで解析された）。

## 5. 再確認結果

（初回納品のみのため未実施）

## 6. 免責

本報告書は静的解析と人手レビューの範囲での指摘であり、対象システムに問題が
存在しないことを示すものではありません。ライブデータベースの状態は対象外です。
