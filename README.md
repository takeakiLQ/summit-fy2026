# 🏔 サミット営業成績ダッシュボード

サミット研修向けの営業成績ダッシュボード。Salesforce の案件情報と月次CSVの売上実績を統合し、チーム・個人別にポイント・売上・粗利を可視化する。

**本番URL**: https://summit-fy2026.pages.dev

---

## 全体アーキテクチャ

```
┌──────────────────────────────────────────────────────────────┐
│  Salesforce (Oppotunities__c)                                │
└─────────────────────────────────────┬────────────────────────┘
                                      │ SOQL（毎時0分）
                                      ▼
┌──────────────────────────────────────────────────────────────┐
│  GitHub Actions (.github/workflows/sync.yml)                 │
│  ① /api/sync/members-json で対象メンバー取得                  │
│  ② sf-extract（SF→JSON）                                     │
│  ③ kpi-compute（ポイント計算）                               │
│  ④ /api/sync/deals（D1へUPSERT＋差分削除＋summary再計算）    │
└─────────────────────────────────────┬────────────────────────┘
                                      ▼
┌──────────────────────────────────────────────────────────────┐
│  Cloudflare D1（SQLite）                                     │
│   teams / members / deals / monthly_revenue / summary /       │
│   settings / meta / audit_log                                 │
└──┬───────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│  Cloudflare Pages Functions (/pages/functions/api/*)         │
│   /api/bootstrap, /api/teams, /api/members, /api/deals,      │
│   /api/monthly-revenue, /api/import-csv, /api/admin/*        │
└──┬───────────────────────────────────────────────────────────┘
   │ Firebase ID Token認証（Authorization: Bearer）
   ▼
┌──────────────────────────────────────────────────────────────┐
│  ブラウザ（pages/public/index.html）                         │
│   Firebase Auth（Google）→ Workers API → 描画                │
└──────────────────────────────────────────────────────────────┘
```

---

## ディレクトリ構成

```
.
├── sf-extract/         Salesforceから案件抽出（TypeScript CLI）
├── kpi-compute/        案件にポイント計算と集計を適用（TypeScript CLI）
├── csv-import/         実績CSVのパース・突合（TypeScript CLI、ローカル用）
├── pages/              Cloudflare Pages（本番運用の中核）
│   ├── public/         静的ファイル（ダッシュボードHTML/JS）
│   ├── functions/      Pages Functions（Workers ランタイム API）
│   ├── migrations/     D1 スキーマ・データ移行
│   ├── wrangler.toml   Pages 設定
│   └── package.json
├── .github/workflows/  GitHub Actions
│   ├── sync.yml        毎時SF→D1同期
│   └── deploy.yml      main push時にCloudflare Pagesへ自動デプロイ
├── docs/               設計書・ガイド
└── csv-samples/        テスト用CSV（.gitignore対象）
```

各モジュールの詳細は `*/README.md` を参照。

---

## 主要技術

| 役割 | サービス・技術 | プラン |
|---|---|---|
| データベース | Cloudflare D1（SQLite） | Free |
| ホスティング | Cloudflare Pages | Free |
| サーバーレス API | Cloudflare Pages Functions（Workersランタイム） | Free |
| 認証 | Firebase Auth（Googleログイン） | Spark（無料） |
| 自動同期 | GitHub Actions | Free |
| Salesforce | REST API + SOQL（Username/Password Flow） | - |
| ダッシュボード | Vanilla JS + Chart.js | - |

**月額コスト: 0円**（軽量化済み、Cloudflare D1の無料枠で十分余裕）

---

## 開発を始める

→ [DEVELOPMENT.md](./DEVELOPMENT.md) を読んでください。

---

## 運用

### 通常運用

- 毎時0分（JST）に GitHub Actions が自動で SF→D1 同期
- 設定画面で「⚙ 設定 → 🔄 SF同期を今すぐ実行」で即時反映可能
- 月次の実績CSV取込は管理者が「📥 実績取込」画面からアップロード

### トラブル時

- **データロールバック**: D1 Time Travel で過去30日に戻せる
  `wrangler d1 time-travel restore summit-fy2026 --bookmark=<bookmark>`
- **デプロイロールバック**: Cloudflare Dashboard → Pages → Deployments → Rollback
- **コードロールバック**: `git revert HEAD && git push`

---

## チーム情報

| チーム | 名前 | 色 |
|---|---|---|
| T1 | 富士 | 薄ピンク |
| T2 | 立山 | 薄ブルー |
| T3 | 剱 | 薄グリーン |
| T4 | 白山 | 薄オレンジ |

メンバー20名（+管理者1名）。詳細は ダッシュボードの「⚙ 設定」画面で確認。

---

## メンテナンスメモ

- GitHub: takeakiLQ/summit-fy2026
- Cloudflare Account ID: c33d78b7cfbb013ac3c5a9fbe817348b
- Firebase Project: summit-fy2026
- ダッシュボードURL: https://summit-fy2026.pages.dev
- 旧URL（リダイレクト用）: https://summit-fy2026.web.app
