# ADR-0002: 動的 DDL を含むスキャンの扱いと、露出前提の可視化

- 状態: 提案（実装は採否確定後）
- 日付: 2026-07-26

## 文脈

2026-07-26 に、同一ワークスペース内の実プロジェクト7件（8パス・70ファイル）へ v0.3.0 を実走させた。
findings は 553件（critical 109 / warning 357 / info 87）。各プロジェクトの DB トポロジ（接続先・アクセス経路・
アプリのドキュメント）を実コードで裏取りしたところ、**critical 109件のうち実リスクは36件（33%）**だった。

前提が成立していなかった73件は、次の2つに分かれる。

1. **動的 DDL によるもの（40件）**
   あるプロジェクトは、マイグレーション末尾で
   `DO $$ … FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename); END LOOP; … $$`
   により全テーブルへ RLS を適用していた。静的解析はこれを追えないため、全テーブルを
   「RLS 未有効」＝ critical と断定した。
   この限界自体は `docs/known-limitations.md:43` と `README.md` に記載済みだが、**出力上は何の合図もなく、
   完全に確信のある critical として提示される**。

2. **露出前提が成立しないもの（33件）**
   Supabase Auth のみを使い、データ平面は別ホスト（マネージド Postgres）や自前 API サーバに置く構成、
   あるいは Supabase を一切使わないローカル Postgres 構成。`public` が PostgREST から配信される前提が成立しない。
   逃げ道（`exposedSchemas`）は既にあり `known-limitations.md` にも書かれているが、
   **critical の山を目にした利用者がその設定へ辿り着く導線が出力側に無い**。

## 決定

### 1. 動的 DDL を検出したら scan warning を出す（採用）

dollar-quoted body（`$$ … $$` / `$tag$ … $tag$`）の内側に `ENABLE ROW LEVEL SECURITY` /
`DISABLE ROW LEVEL SECURITY` / `CREATE POLICY` / `DROP POLICY` が現れた場合、
その旨を **scan warning** として1件出す。splitter は既に dollar-quote を追跡している
（`src/parser/splitter.ts`）ため、検出は既存機構の範囲で足りる。

これは 0.3.0 で導入した「不完全スキャン」契約にそのまま合流する:

- テキストレポータは緑の `✔` を出さない（`⚠ … scan warning(s) prevent a clean pass`）
- `--strict` は exit 2（tool error）で、findings による exit 1 とは区別される

つまり「静的には判定不能な領域がある」という事実が、CI で沈黙しない。

### 2. 露出前提を出力に明示する（採用・ドキュメント/出力のみ）

`RLS001` / `RLS004` / `RLS005` を1件以上出したレポートの末尾に、
「これらは `exposedSchemas`（既定 `["public"]`）が PostgREST から配信されるという前提に立つ。
Supabase Auth のみ利用でデータが別 DB にある構成、サーバ API 経由のみの構成では
`exposedSchemas` を設定せよ」という趣旨のヒントを1行出す。新しい設定キーは足さない。

## Why not（採用しなかった案）

- **DO ブロックの中身を評価して個別テーブルの RLS 状態を推定する** — 却下。
  PL/pgSQL の実行意味論に加え、`pg_tables` などカタログ問い合わせの結果に依存するため、
  静的には決定不能。部分的に真似ると「一部の書き方だけ正しく、他は静かに間違う」状態になる。
- **動的 DDL を見つけたら RLS001 を抑制する** — 却下。今回の実例は正しく RLS を付けていたが、
  「DO ブロックがあるが目的のテーブルには適用していない」ケースと静的には区別できない。
  抑制は真の欠落を隠す方向の誤りであり、警告して不完全を明示する方向の誤りより悪い。
- **新ルール `RLS019` として起票する** — 却下。動的 DDL はスキーマ状態の欠陥（＝ルール違反）ではなく
  解析可能性の限界であり、`findings` ではなく `warnings` の層に属する。
- **`postgrestExposed: false` のような新しい設定キーを足す** — 却下。`exposedSchemas: []` で同じ意味を
  表現でき、設定が二重化する。不足しているのは機構ではなく導線。

## 影響

- 変更は parser/scan の warning 経路と reporters のみ。ルール定義とスコアリングは変えない。
- 既存利用者への影響: 動的 DDL を含むリポジトリでは `--strict` が exit 2 に変わりうる（＝挙動変更）。
  次の minor で入れ、CHANGELOG の Changed に明記する。
- 検証: 動的 DDL の**合成**マイグレーションを `examples/` へ追加し、
  scan warning の発生と `--strict` の exit 2 を回帰テストで固定する。
  ADR-0001 の境界に従い、実プロジェクト由来の SQL・プロジェクト名は本リポジトリへ持ち込まない。

## 未解決

- ヒント行を text 以外（json / sarif）へどう出すか。`warnings[]` に混ぜると
  「不完全スキャン」の意味が薄まるため、別フィールドが要るかもしれない。
- 実露出の確認（anon キーでの実 API アクセス）はツールの範囲外であり、
  運用側の boundary evidence として残す。
