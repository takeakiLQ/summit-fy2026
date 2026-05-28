# GitHub Actions セットアップガイド（Step 3）

サミット営業成績ダッシュボードの **Salesforce → Firestore 同期** を GitHub Actions Cron で毎時自動化します。

## 完了後の運用イメージ

```
[GitHub Actions]
   ├ 毎時0分に自動実行
   ├ sf-extract で Salesforce から案件取得
   ├ kpi-compute でポイント計算
   └ firestore-sync で Firestore に書込
        ↓
[Firestore]
        ↓ リアルタイム読込
[ブラウザ] https://summit-fy2026.web.app
```

**結果**: 毎時、最新の案件データがダッシュボードに自動反映される。PC を開いていなくても OK。

## セットアップ手順

### 1. リポジトリの準備（まだ push していなければ）

```powershell
cd D:\Claude\トップ営業研修（サミット）
git init
git remote add origin https://github.com/takeakiLQ/summit-fy2026.git

# .gitignore がない場合は作成
@"
node_modules/
**/node_modules/
.env
**/.env
service-account.json
firebase-adminsdk-*.json
*.log
output/
*.pdf
dashboard/data.js
"@ | Set-Content .gitignore

git add .
git commit -m "Initial commit: 4モジュール構成 + Firebase + Step 3 ワークフロー"
git branch -M main
git push -u origin main
```

**⚠ 重要**: `.env`（SF認証情報）と `service-account.json`（Firebase秘密鍵）は **絶対に push しないこと**。`.gitignore` で除外を必ず確認。

### 2. GitHub Secrets を設定

リポジトリページを開く → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

以下 8 個を 1 つずつ登録（Name と Secret に分けて）:

| Name | 値の内容 |
|---|---|
| `SF_AUTH_TYPE` | `username_password` |
| `SF_LOGIN_URL` | `https://login.salesforce.com` |
| `SF_CLIENT_ID` | Connected App の Consumer Key |
| `SF_CLIENT_SECRET` | Connected App の Consumer Secret |
| `SF_USERNAME` | `takeaki.mandokoro@logiquest.co.jp` |
| `SF_PASSWORD` | SFパスワード |
| `SF_SECURITY_TOKEN` | SFセキュリティトークン |
| `FIREBASE_SERVICE_ACCOUNT` | **`firestore-sync/service-account.json` の中身をすべてコピペ** |

`FIREBASE_SERVICE_ACCOUNT` は JSON 全体を 1 つの Secret に貼り付けます（改行含む）。

### 3. ワークフローの確認

リポジトリの **Actions** タブを開く → 「Salesforce → Firestore 自動同期」が表示されているはず。

「**Run workflow**」ボタンで手動実行してテスト → 成功すれば毎時自動で回ります。

### 4. 実行結果の確認

各実行のログは Actions タブから確認可能:

```
sf-extract — Salesforce認証情報を .env に書き出し ... ✓
sf-extract — 依存インストール ... ✓
sf-extract — Salesforce案件抽出 ... ✓ (例: 579件)
kpi-compute — KPI計算 ... ✓
firestore-sync — Firestoreに書込 ... ✓ (deals 579件書込)
同期完了通知 ... ✓
```

ダッシュボード `https://summit-fy2026.web.app` を開いて F5 → 案件が最新になっているはず。

## 仕様

### 実行スケジュール

- **毎時0分**（UTC基準。日本時間でも毎時0分）
- 1日24回、月720回、1回あたり約2分 → 月24分 → GitHub Actions無料枠（2,000分/月）の1.2%

### 実行内容

1. **sf-extract**: Salesforce から FY2025 全期間（2025-04-01〜）の案件を取得
2. **kpi-compute**: 全案件にポイント計算と集計を適用
3. **firestore-sync**: deals コレクションを Firestore に書き込み（実績データは触らない）

### CSV取込は自動化しない

月次CSVは管理者が手動でダッシュボードから取り込み続けます（自動化対象外）。CSV のアップロード頻度が低く、ファイルが GitHub にないため。

## トラブルシューティング

### ワークフロー実行が失敗する

Actions タブのログを確認:

- **`Salesforce 認証失敗`**: SF_CLIENT_ID / SF_CLIENT_SECRET / SF_USERNAME 等の Secret が間違っているか、トークンが期限切れ。
- **`サービスアカウント鍵が見つかりません`**: `FIREBASE_SERVICE_ACCOUNT` Secret に JSON 全体（`{` から `}` まで）を貼っているか確認。
- **`PERMISSION_DENIED`**: Firebase 側の問題。再度キーを発行して Secret を更新。

### 一時的にスケジュール停止したい

`.github/workflows/sync.yml` の `schedule:` 行をコメントアウトして push:

```yaml
on:
  # schedule:
  #   - cron: '0 * * * *'
  workflow_dispatch:
```

これで手動実行のみになる。

### スケジュール間隔を変更したい

`cron` を編集:

- `'0 * * * *'` 毎時0分
- `'0 */6 * * *'` 6時間ごと
- `'0 9 * * 1-5'` 平日朝9時のみ
- `'0 0 * * *'` 毎日0時のみ

[crontab.guru](https://crontab.guru/) で動作確認できる。

## セキュリティ上の注意

- Secret は GitHub Actions 内でのみ復号され、ログには表示されない（自動マスク）
- リポジトリは **プライベート設定** にすること
- 鍵やパスワードが万一漏洩した場合は、すぐに Salesforce 側でパスワード変更＋トークン再発行、Firebase 側で鍵を無効化＋再発行

## 次のステップ

Step 3 が安定稼働したら:

- **設計書 v1.2 更新**: ここまでの全変更を 1 つの Word に集約
- **設定画面（管理者用UI）**: 係数・ポイント・チーム名をブラウザから変更可能に
- **メール通知**: 新規案件発生時の自動通知
