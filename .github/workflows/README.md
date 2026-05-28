# GitHub Actions セットアップガイド（Cloudflare D1 同期）

毎時の Salesforce → Cloudflare D1 同期を GitHub Actions で自動化しています。

## 動作イメージ

```
[GitHub Actions] 6時間ごとに自動実行（JST 9/15/21/3時）
   ├ ① Cloudflare API から members.json を取得（設定画面の最新状態をSOQLに反映）
   ├ ② sf-extract で Salesforce から案件取得
   ├ ③ kpi-compute でポイント計算
   └ ④ Cloudflare D1 に書込（UPSERT + 差分削除 + サマリー再計算）
        ↓
[Cloudflare D1]
        ↓ Workers API
[ブラウザ] https://summit-fy2026.pages.dev
```

## 必要な GitHub Secrets

リポジトリ → Settings → Secrets and variables → Actions → New repository secret

| Name | 値 |
|---|---|
| `SF_AUTH_TYPE` | `username_password` |
| `SF_LOGIN_URL` | `https://login.salesforce.com` |
| `SF_CLIENT_ID` | Connected App の Consumer Key |
| `SF_CLIENT_SECRET` | Connected App の Consumer Secret |
| `SF_USERNAME` | `takeaki.mandokoro@logiquest.co.jp` |
| `SF_PASSWORD` | SFパスワード |
| `SF_SECURITY_TOKEN` | SFセキュリティトークン |
| **`CLOUDFLARE_PAGES_URL`** | **`https://summit-fy2026.pages.dev`** |
| **`SYNC_API_KEY`** | **Wrangler に登録したのと同じ値** |

⚠ 古い `FIREBASE_SERVICE_ACCOUNT` は不要になったので **削除可能**。

## 動作確認

リポジトリの Actions タブ → 「Salesforce → Cloudflare D1 自動同期」→ Run workflow で手動実行。

成功ログ例:
```
sf-extract — Salesforce案件抽出 ... ✓ (579件)
kpi-compute — KPI計算 ... ✓
Cloudflare D1 に案件データを投入 ...
  Deals to import: 579
  Status: 200 ( 3.5 s )
  Response: {"ok":true,"upserted":579,...}
✅ Salesforce → Cloudflare D1 同期 完了
```

## スケジュール変更

`sync.yml` の `cron:` を編集:

- `'0 */6 * * *'` 6時間ごと（現在の設定）
- `'0 */3 * * *'` 3時間ごと
- `'0 * * * *'` 毎時
- `'0 9 * * 1-5'` 平日朝9時のみ

[crontab.guru](https://crontab.guru/) で動作確認できる。

## セキュリティ

- Secret は GitHub Actions 内でのみ復号され、ログには表示されない（自動マスク）
- リポジトリは **プライベート設定** にすること
- `SYNC_API_KEY` が漏れた場合は `wrangler pages secret put SYNC_API_KEY` で再登録 + GitHub Secrets も更新
