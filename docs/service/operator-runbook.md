# 運用ランブック（operator runbook）

RLSスポット監査（[docs/service/README.md](./README.md)）1件のライフサイクルと、
顧客資料の保持・削除ポリシーを定義する。境界の決定は
[ADR-0001](../03_adrs/ADR-0001-rls-spot-audit-service-boundary.md) を原本とする。

## 状態遷移

```text
FIT → ORDERED → RECEIVED → ACCEPTED | REJECTED
                              ↓
                          SCANNED → MANUAL_REVIEW → DELIVERED → (RECHECKED) → EXPIRED → DELETED
```

| 状態 | 意味 | 完了条件 |
| ---- | ---- | -------- |
| FIT | 15分の適合確認済み | 対象・件数・目的が本サービスに適合すると双方確認 |
| ORDERED | 発注確定 | order-and-intake の発注確認に全項目合意 |
| RECEIVED | 資料受領 | 受領物を Git 管理外の `.audit-work/` に隔離 |
| ACCEPTED | 受け入れ判定 OK | 受領時チェック全項目 OK |
| REJECTED | 受け入れ判定 NG | 差し戻し理由を通知し、受領物を即時削除 |
| SCANNED | CLI スキャン完了 | 使用バージョン・解析警告数を記録 |
| MANUAL_REVIEW | 人手判定完了 | 全検出に真陽性 / 偽陽性 / 意図的公開を付与 |
| DELIVERED | 初回納品 | 報告書送付、**初回納品日**を記録（以後の期限の起点） |
| RECHECKED | 再確認完了 | 再確認結果を報告書に追記（初回納品から30日以内・1回） |
| EXPIRED | 受付終了 | 初回納品から30日経過で再確認受付を終了 |
| DELETED | 顧客資料の完全削除 | 初回納品から37日までに受領物・作業ファイル・非公開報告書を削除し、削除日を記録 |

## 保持・削除ポリシー

- 再確認の受付は**初回納品から30日**まで（以後 EXPIRED）。
- 顧客から受領した資料・`.audit-work/` 内の作業ファイル・非公開報告書は、
  **初回納品から37日**（30日 + 削除作業猶予7日）までに完全削除する（DELETED）。
- 顧客資料・非公開報告書は Git にコミットしない。`.gitignore` の
  `.audit-work/` / `audit-work/` / `*.zip` / `*-private-report.md` で強制する。
- 削除完了は削除日と対象の一覧をローカルの案件記録（リポジトリ外）に残す。

## 事故時の対応

- 顧客資料をコミットしてしまった場合: push 前なら履歴から除去、push 済みなら
  直ちに顧客へ連絡し、履歴書き換えと漏えい影響の報告を行う（この操作は
  destructive であり人間の承認を必須とする）。
