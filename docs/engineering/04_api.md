<!-- generated-by: scripts/generate_engineering_docs.py -->
# Supabase RLS Guard — API定義書

> 生成日: 2026-07-15 / 対象: `supabase-rls-guard` / 確度: [高]
> 実装・manifest・既存資料の静的棚卸しに基づく。外部サービスの稼働状態と本番構成は未検証。


## Public interface inventory（手動検証 2026-07-19）

自動棚卸しでは未検出だったが、実装確認により公開インターフェースは
**CLI + library の2系統**（HTTP endpoint なし）。

### CLI（`bin`: `supabase-rls-guard` / `rlsguard` → `dist/cli.mjs`）

- 実装: `src/cli.ts`（citty）。単一コマンド + flags（`--format` / `--strict` /
  `--fail-on` / `--config` / `--disable` / `--backend` / `--quiet` /
  `--allow-empty` / `--list-rules` 等）。
- exit-code 契約: `0` = 閾値以上の finding なし / `1` = finding あり /
  `2` = ツール・設定エラー、0ファイルスキャン、および `--strict` 時の不完全
  スキャン（parser fallback・読み取り不能エントリ・設定不備）。
- 契約の固定先: `tests/cli.test.ts`（ビルド済みバイナリを spawn して検証）。

### Library（`src/index.ts` re-export、ESM のみ）

| Entrypoint | 責務 | ユースケース |
|---|---|---|
| `scan(options)` | discover → parse → fold → rules → summary の一括実行 | CI 組み込み・エディタ拡張など通常利用の入口 |
| `loadConfig` / `ConfigOverrides` | cosmiconfig 探索と CLI override の解決 | `scan` に渡す設定を事前解決したい場合 |
| `discover` | migration `.sql` の列挙（順序・重複排除・スキップ警告） | 対象ファイル一覧だけ欲しい場合 |
| `parseSql` / `BackendChoice` | 1ファイルの SQL → statement 列（libpg/regex） | 低レベル統合・独自ルール実験 |
| `createEmptyState` / `foldStatements` / `exposedTables` / `tableKey` | schema 状態の畳み込み | 独自解析でスキーマ最終状態を使う場合 |
| `ALL_RULES` / `evaluateRules` / `ruleList` | ルール一覧と評価 | ルールの選別・一覧表示 |
| `render` | ScanResult → text / json / github / sarif | 出力形式の変換のみ行う場合 |
| `VERSION` / `TOOL_NAME` / `HOMEPAGE` | メタ情報 | レポートへの埋め込み |

- 責務境界: 通常は `scan` + `render` のみを使う。`parseSql` / fold 系は内部
  表現（`src/core/types.ts`）に依存するため、pre-1.0 では破壊的変更があり得る。

## API所有境界

- CLI 契約: `src/cli.ts` が所有（flag 追加・exit code 変更はここと
  `tests/cli.test.ts` を同時に更新）。
- Library 契約: `src/index.ts` の re-export が公開面。ここに載せない限り
  内部 module は非公開扱い。

## 変更時の実務チェック

- caller: UI caller未検出。CLI/job/external callerを検索
- schema: route内inline validationだけでなく共有schema・型・OpenAPIの有無を確認する。
- auth: `未確認` のendpointは公開を意味しない。middleware、gateway、provider側設定も確認する。
- error: 表中にstatus signalがないhandlerは、成功/入力/権限/依存障害の契約をtestで固定する。
- write: POST/PUT/PATCH/DELETEは冪等性、重複retry、監査ログ、rollbackを確認する。

## 未確認

- 動的に登録されるroute、gateway rewrite、provider callback、production側rate limit。
- request/responseの完全なfield定義は、表の実装pathと共有schemaを正典として確認する。
