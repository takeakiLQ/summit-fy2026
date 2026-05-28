# 開発手順書

社内エンジニア向けの開発手順。新規参加者はまずこれを読む。

---

## 0. 必要なもの

### アカウント・権限

| サービス | 必要な権限 | 連絡先 |
|---|---|---|
| GitHub: `takeakiLQ/summit-fy2026` | Collaborator (Write) | 武明（takeaki.mandokoro@logiquest.co.jp） |
| Cloudflare アカウント | Workers/Pages にアクセスできる権限 | 武明 |
| Firebase Console: `summit-fy2026` | 閲覧可（直接触ることはほぼ無い） | 武明 |
| Salesforce | 案件オブジェクトの確認用、開発に必須ではない | 武明 |
| ダッシュボード admin | 「⚙ 設定」画面アクセス用 | 武明（D1のmembersテーブルでロール変更） |

### ローカル環境

```bash
# Node.js v20+
node --version  # v20.x.x

# wrangler CLI（Cloudflare）
npm install -g wrangler
wrangler --version  # 4.x

# wrangler ログイン
wrangler login
wrangler whoami
```

---

## 1. リポジトリクローンと初期セットアップ

```bash
git clone https://github.com/takeakiLQ/summit-fy2026.git
cd summit-fy2026
```

各モジュールに `node_modules/` があり、それぞれで `npm install` が必要（CI環境では自動）。

```bash
# 例: ローカルでpages側を触る場合
cd pages
npm install
```

---

## 2. アーキテクチャ理解

[README.md のアーキテクチャ図](./README.md#全体アーキテクチャ) を先に読む。

ざっくり要約:

- **Salesforce** が一次データソース（案件マスタ）
- **GitHub Actions** が毎時 SF → Cloudflare D1 へ同期
- **Cloudflare D1** が本番DB（SQLite）
- **Cloudflare Pages + Functions** が ホスティング + API
- **Firebase Auth** が認証のみ担当（DB は Firebase じゃない）
- **ブラウザ** で Firebase ログイン → Workers API → D1

---

## 3. ローカル開発の進め方

### A. ダッシュボードのフロントだけ触る

```bash
cd pages
npx wrangler pages dev ./public
# → http://localhost:8788 で起動
```

ローカルでブラウザを開くと **本番のFirebase Authに繋がる** ので、そのまま自分のGoogleアカウントでログインできる。

API 呼び出しはローカル Workers Functions が処理。**D1 はローカルのSQLite** に切り替わるので、本番には影響なし。

### B. D1 のローカル DB をセットアップ

```bash
cd pages
# スキーマを流す
wrangler d1 execute summit-fy2026 --local --file=./migrations/0001_initial_schema.sql
wrangler d1 execute summit-fy2026 --local --file=./migrations/0002_initial_master_data.sql
wrangler d1 execute summit-fy2026 --local --file=./migrations/0003_add_deal_kind.sql
wrangler d1 execute summit-fy2026 --local --file=./migrations/0004_add_monthly_revenue_kind.sql

# 確認
wrangler d1 execute summit-fy2026 --local --command="SELECT COUNT(*) FROM teams"
```

dealsデータをローカルにも入れたい場合は、`pages/migrations/import-deals.mjs` をローカルURL (`http://localhost:8788`) 向けに実行。

### C. sf-extract や kpi-compute を試す

```bash
cd sf-extract
cp .env.example .env  # 中身を埋める（Salesforce Connected App情報）
npm install
npm run extract -- --out output/test.json

cd ../kpi-compute
npm install
npm run compute -- --in ../sf-extract/output/test.json --out-base test
```

---

## 4. 共同開発フロー

### ブランチ運用

```bash
# 1. mainから最新をpull
git checkout main && git pull

# 2. 機能用ブランチを切る
git checkout -b feature/xxx

# 3. 作業 & コミット
git add -A
git commit -m "xxx を実装"

# 4. push
git push -u origin feature/xxx

# 5. GitHub上でPRを作成
# → 自動で Cloudflare Pages にプレビューデプロイされる
# → PR に「🚀 プレビューデプロイ完了！」のコメントが付く

# 6. レビューを依頼 → Approve → main にマージ
# 7. mainマージで本番に自動デプロイ
```

**main への直接 push は禁止**（ブランチ保護で弾かれる）。必ず PR 経由。

### デプロイ

`main` への push で **自動デプロイ**（`.github/workflows/deploy.yml`）。

手動デプロイが必要な場合:

```bash
cd pages
wrangler pages deploy ./public --project-name=summit-fy2026 --branch=main
```

### D1 スキーマ変更

スキーマ変更は **必ずマイグレーションファイル** で:

```bash
# 1. 新しいマイグレーションSQL作成
# pages/migrations/000X_xxx.sql

# 2. ローカルで試す
wrangler d1 execute summit-fy2026 --local --file=./migrations/000X_xxx.sql

# 3. レビュー後、本番に適用
wrangler d1 execute summit-fy2026 --remote --file=./migrations/000X_xxx.sql

# 4. PRに「本番D1適用済み」を明記
```

---

## 5. 主要 API エンドポイント

| メソッド | パス | 用途 | 認証 |
|---|---|---|---|
| GET | /api/bootstrap | 初回ロード用一括取得 | Firebase IDToken |
| GET | /api/teams | チーム一覧 | Firebase IDToken |
| POST | /api/teams | 新規チーム | admin |
| PUT | /api/teams/:id | チーム更新 | admin |
| GET | /api/members | メンバー一覧 | Firebase IDToken |
| POST | /api/members | 新規メンバー | admin |
| PUT | /api/members/:email | メンバー更新 | admin |
| GET | /api/deals?owner=email | 個人別案件 | Firebase IDToken |
| GET | /api/deals/:id | 案件詳細 | Firebase IDToken |
| GET | /api/monthly-revenue?deal=:id | 案件別実績 | Firebase IDToken |
| POST | /api/import-csv | CSV取込 | admin |
| POST | /api/sync/deals | GitHub Actions用 | x-sync-api-key |
| POST | /api/sync/financials | GitHub Actions用 | x-sync-api-key |
| GET | /api/sync/members-json | members.json生成 | x-sync-api-key |
| POST | /api/admin/sync-now | GitHub Actions手動起動 | admin |

詳しくは `pages/functions/api/` の各 `.ts` ファイル参照。

---

## 6. デバッグ Tips

### Workers のログ

```bash
wrangler pages deployment tail --project-name=summit-fy2026
```

ライブで `console.log` が見られる。

### D1 を直接覗く

```bash
# テーブル件数
wrangler d1 execute summit-fy2026 --remote --command="SELECT COUNT(*) FROM deals"

# 特定メンバーの案件
wrangler d1 execute summit-fy2026 --remote --command="SELECT id, name, kind FROM deals WHERE owner_email='xxx@logiquest.co.jp' LIMIT 5"

# summary を見る
wrangler d1 execute summit-fy2026 --remote --command="SELECT json_extract(value, '$.activeMemberCount') FROM summary WHERE key='aggregate'"
```

### ブラウザのデバッグ

開発者ツールのコンソールで:

```javascript
window.__SUMMARY__       // 集計サマリー全体
window.__USER_ROLE__     // 自分のロール
window.__TEAMS_ALL__     // 全チーム
window.__MEMBERS_ALL__   // 全メンバー
await window.__LOAD_PERSON_DEALS__('沖田 博之')  // 個人別案件をlazy load
```

---

## 7. トラブルシューティング

### 「データ読込失敗 401」

- Firebase IDトークンが取れていない → ログアウト → 再ログイン
- Firebase Auth API キーが Workers secret に未登録

### CSV取込で全件未突合

- マニュアル番号の正規化問題（ハイフンの扱い）
- SF側の Manual__c と CSV側の形式を比較

### GitHub Actions が動かない

- Secrets を確認（リポジトリ Settings → Secrets and variables → Actions）
- 必須: SF_*, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SYNC_API_KEY, GITHUB_TOKEN, GITHUB_REPO

### D1 のクォータ超過

- Time Travel で前日に戻せる
- 設定画面で何度も保存していないか確認（軽量化済みだが）
- 過剰なリロードを避ける（5分キャッシュあり）

---

## 8. 設計判断の経緯

| 判断 | 理由 |
|---|---|
| Firestoreから D1 へ移行 | Spark プランの読取上限 5万/日では足りなかった |
| Firebase Auth は残す | 認証のみなら無料・無制限、認証フローを再開発するコストを避けた |
| 集計サマリーを事前生成 | ダッシュボード初回ロードの読取量を 3,500件→数件に削減 |
| 個人詳細を lazy load | dealsの全件取得を不要に |
| 認証は Cloudflare Access ではなく Firebase Auth | 既存のドメイン制限・ログイン体験を維持しつつ Cloudflare Access設定を不要に |

---

## 9. 連絡

質問・相談は武明まで（takeaki.mandokoro@logiquest.co.jp）。
