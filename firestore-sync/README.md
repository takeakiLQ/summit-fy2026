# firestore-sync — ローカル → Firestore 書き込みモジュール

ローカルの `sf-extract` / `kpi-compute` / `csv-import` の出力を Firebase Firestore に書き込みます。Admin SDK 経由なのでセキュリティルールをバイパスして書き込めます。

## セットアップ

### 1. サービスアカウント鍵を配置

Firebase Console → プロジェクト設定 → サービスアカウント → 「新しい秘密鍵を生成」で JSON ファイルをダウンロード。

```
D:\Claude\トップ営業研修（サミット）\firestore-sync\service-account.json
```

このパスに保存してください（ファイル名は `service-account.json`）。

**⚠ 重要**: このファイルは絶対に Git にコミットしないこと。`.gitignore` で除外済みです。

### 2. npm install

```powershell
cd D:\Claude\トップ営業研修（サミット）\firestore-sync
npm install
```

`firebase-admin`, `tsx`, `typescript` がインストールされます（数十秒）。

## 実行

### 全部書き込み（標準）

```powershell
npm run sync
```

以下を一気に Firestore に書き込みます:

1. **チーム・メンバー**: `sf-extract/config/members.json` → `teams/` `members/` コレクション
2. **設定値**: `kpi-compute/config/kpi-settings.json` と `sf-extract/config/columns.json` → `settings/kpi` `settings/filters`
3. **案件**: `kpi-compute/output/*_deals.json` の最新 → `deals/` コレクション
4. **実績**: `csv-import/output/*.json` の最新 → `monthly_revenue/` コレクション
   - UPSERT 挙動: 取込ファイルの対象月のドキュメントは事前に削除されてから書き直されます

### チーム・メンバーのみ

```powershell
npm run sync -- --teams-members-only
```

初期化用。`sf-extract` 等を動かさずに、まず名簿だけ Firestore に入れたいとき。

### 部分実行

```powershell
npm run sync -- --skip-deals        # 案件は書込まない
npm run sync -- --skip-financials   # 実績は書込まない
```

## Firestore コレクション構造

詳細は `../dashboard/firestore-schema.md` を参照。

- `teams/{teamId}` ... チーム情報
- `members/{email}` ... メンバー
- `deals/{dealId}` ... 案件（KPI計算結果付き）
- `monthly_revenue/{yearMonth_dealId}` ... 月別売上・粗利
- `settings/kpi` `settings/filters` ... 設定値
- `meta/sync_status` ... 同期状態

## トラブルシューティング

### `エラー: サービスアカウント鍵が見つかりません`

`service-account.json` を `firestore-sync/` 直下に配置してください。Windows でダウンロードすると `service-account.json.json` のように二重拡張子になる場合があります。エクスプローラーで拡張子を確認してリネームしてください。

### `PERMISSION_DENIED`

サービスアカウント鍵が古い／無効化されているか、プロジェクトIDが違う可能性。Firebase Console から新しい鍵を再生成してください。

### `Quota exceeded`

Firestore の無料枠（書込 20,000/日）を超えた可能性。1 日待つか、Blaze プランへの移行を検討。本件の規模では通常超えません。

## 次のステップ

- **Step 2-C**: ダッシュボードを Firestore 読み込みに切り替え
- **Step 2-D**: CSV インポート画面の Firestore 書き込み実装
- **Step 3**: GitHub Actions Cron で sf-extract → kpi-compute → firestore-sync を完全自動化
