# 🏔 サミット営業成績ダッシュボード

サミット研修向け営業成績ダッシュボード。Salesforce の案件情報と月次CSVの売上実績を統合し、チーム・個人別にポイント・売上・粗利・ランキングを可視化する。

- **本番URL**: https://summit-fy2026.pages.dev
- **構成**: Cloudflare D1 + Cloudflare Pages Functions + Firebase Auth（無料運用）
- **同期**: GitHub Actions で 毎時0分（JST）に Salesforce → D1 自動同期

---

## 機能ハイライト

- **チーム/個人別ランキング** — ポイント / 売上 / 粗利の3軸で切替表示。
- **期間フィルタ** — 全期間／年度（FY）／月単位で柔軟に切替。
- **ドリルダウン** — 個人 → 担当案件 → 案件詳細（Salesforceリンク付き）/月別実績。
- **案件種別** — Qhai / ByQ（都市物流営業部・緊急便）を自動判定して色分け表示。ヘッダで実績データの月範囲も種別別に表示。
- **設定画面（admin専用）** — チーム・メンバーの追加/編集/非表示化、KPI設定変更、SF同期の手動トリガー。
- **CSV実績取込** — ブラウザから複数CSVを一括アップロード、マニュアル番号自動正規化、同一月の売上合算。
- **担当案件リスト** — 全カラムでクリックソート対応、デフォルト稼働開始昇順。
- **共同開発対応** — GitHub の PR → 自動プレビューデプロイ → mainマージで本番反映。

---

## 全体アーキテクチャ

```
┌──────────────────────────────────────────────────────────────┐
│  Salesforce (Oppotunities__c)                                │
└─────────────────────────────────────┬────────────────────────┘
                                      │ SOQL（毎時0分 JST）
                                      ▼
┌──────────────────────────────────────────────────────────────┐
│  GitHub Actions (.github/workflows/sync.yml)                 │
│   ① /api/sync/members-json で対象メンバー（active）取得      │
│   ② sf-extract（SF→JSON, Group_FY22__c で種別判定）          │
│   ③ kpi-compute（ポイント計算）                              │
│   ④ /api/sync/deals（D1へUPSERT＋差分削除＋summary再計算）   │
└─────────────────────────────────────┬────────────────────────┘
                                      ▼
┌──────────────────────────────────────────────────────────────┐
│  Cloudflare D1（SQLite）                                     │
│   teams / members / deals / monthly_revenue /                 │
│   summary / settings / meta / audit_log                       │
└──┬───────────────────────────────────────────────────────────┘
   │ Workers (Pages Functions)
   ▼
┌──────────────────────────────────────────────────────────────┐
│  /pages/functions/api/                                       │
│   bootstrap / teams / members / deals / monthly-revenue /     │
│   import-csv / admin/sync-now / sync/*                        │
└──┬───────────────────────────────────────────────────────────┘
   │ Firebase ID Token認証（Authorization: Bearer）
   ▼
┌──────────────────────────────────────────────────────────────┐
│  ブラウザ（pages/public/index.html）                         │
│   Firebase Auth（Google）→ Workers API → 描画                │
└──────────────────────────────────────────────────────────────┘
```

データフローの設計判断の経緯は [ARCHITECTURE-HISTORY.md](./ARCHITECTURE-HISTORY.md) 参照。

---

## ディレクトリ構成

```
.
├── sf-extract/         Salesforce 案件抽出モジュール（TypeScript）
├── kpi-compute/        ポイント計算・集計モジュール（TypeScript）
├── csv-import/         実績CSVパース・突合モジュール（ローカル用）
├── pages/              Cloudflare Pages（本番運用の中核）
│   ├── public/         静的ファイル
│   │   ├── index.html       ダッシュボード本体
│   │   ├── data-loader.js   API呼び出し + window グローバル
│   │   ├── settings-writer.js  設定画面の書込API
│   │   ├── auth-guard.js    Firebase Auth ガード
│   │   └── firebase-config.js  Firebase Web 構成（公開キー）
│   ├── functions/      Pages Functions（Workers API）
│   │   ├── _middleware.ts   認証・ロール判定
│   │   └── api/
│   │       ├── bootstrap.ts          初回ロード一括取得
│   │       ├── teams.ts / teams/[id].ts        チーム CRUD（admin）
│   │       ├── members.ts / members/[email].ts メンバー CRUD（admin）
│   │       ├── deals.ts / deals/[id].ts        案件取得（lazy）
│   │       ├── monthly-revenue.ts              実績取得（lazy）
│   │       ├── import-csv.ts                   ブラウザCSV取込
│   │       ├── admin/sync-now.ts               GH Actions手動起動
│   │       └── sync/                           GH Actions専用
│   │           ├── deals.ts                    SF案件取込
│   │           ├── financials.ts               実績取込
│   │           ├── members-json.ts             members.json生成
│   │           ├── teams-members.ts            マスタ同期
│   │           ├── recompute.ts                summary再計算
│   │           ├── _recompute.ts (lib)         集計ロジック
│   │           └── _aggregate.ts (lib)         集計関数
│   ├── migrations/     D1 スキーマ・データ
│   │   ├── 0001_initial_schema.sql             初期スキーマ
│   │   ├── 0002_initial_master_data.sql        初期マスタ
│   │   ├── 0003_add_deal_kind.sql              案件種別 kind カラム
│   │   ├── 0004_add_monthly_revenue_kind.sql   実績の kind カラム
│   │   ├── import-deals.mjs                    ローカル→D1投入ツール
│   │   └── import-financials.mjs               同上、実績用
│   ├── wrangler.toml
│   └── package.json
├── .github/workflows/
│   ├── sync.yml        毎時 SF→D1 同期
│   └── deploy.yml      main push 時に Cloudflare Pages へ自動デプロイ
├── firebase-redirect/  旧URL（web.app）からの自動リダイレクト
├── docs/               設計書
├── csv-samples/        テスト用CSV（.gitignore対象）
├── README.md           ← このファイル
├── DEVELOPMENT.md      開発手順書
└── ARCHITECTURE-HISTORY.md  設計判断の経緯
```

---

## 技術スタック

| 役割 | サービス・技術 | プラン | 月額 |
|---|---|---|---|
| データベース | Cloudflare D1（SQLite） | Free | ¥0 |
| ホスティング | Cloudflare Pages | Free | ¥0 |
| サーバーレス API | Cloudflare Pages Functions（Workers） | Free | ¥0 |
| 認証 | Firebase Auth（Googleログイン） | Spark | ¥0 |
| 自動同期 | GitHub Actions | Free | ¥0 |
| Salesforce | REST API + SOQL（Username/Password Flow） | - | - |
| ダッシュボード | Vanilla JS + Chart.js | - | - |

**月額コスト: 0円**（軽量化＋事前集計済み。Cloudflare D1 の無料枠の数%しか使わない）

---

## 開発を始める

社内エンジニアは [DEVELOPMENT.md](./DEVELOPMENT.md) を必ず読んでください。
- ローカル環境構築
- ブランチ/PRフロー
- D1マイグレーションの作法
- API一覧
- デバッグTips
- トラブルシューティング

---

## 主要な運用フロー

### 通常運用

1. **毎時0分（JST）** に GitHub Actions が自動で SF→D1 同期。
2. 月次の実績CSVは管理者が「📥 実績取込」画面から複数ファイル一括アップロード。
3. メンバー追加・チーム名変更・非表示化などは「⚙ 設定」画面から admin が操作。
4. 設定変更後の即時反映は「🔄 SF同期を今すぐ実行」または「🔄 最新化」ボタン。

### 緊急時のロールバック

| 対象 | コマンド／操作 |
|---|---|
| **コード** | `git revert HEAD && git push`（GitHub Actions が自動で前バージョンを再デプロイ） |
| **デプロイ** | Cloudflare Dashboard → Pages → Deployments → 過去30回分から1クリックでRollback |
| **D1データ** | `wrangler d1 time-travel restore summit-fy2026 --bookmark=<bookmark>`（過去30日まで） |

---

## チーム情報

| ID | 名前 | カラー |
|---|---|---|
| T1 | 富士 | 薄ピンク |
| T2 | 立山 | 薄ブルー |
| T3 | 剱 | 薄グリーン |
| T4 | 白山 | 薄オレンジ |

（チーム名・カラー・並び順・追加/非表示化は「⚙ 設定」画面で変更可能。本部など研修対象外のチームは active=false で非表示化）

---

## メンテナンスメモ

- **GitHub**: takeakiLQ/summit-fy2026
- **Cloudflare Account ID**: c33d78b7cfbb013ac3c5a9fbe817348b
- **Firebase Project**: summit-fy2026
- **ダッシュボードURL**: https://summit-fy2026.pages.dev
- **旧URL（リダイレクト）**: https://summit-fy2026.web.app
- **管理者連絡先**: 武明（takeaki.mandokoro@logiquest.co.jp）
- **共同開発者**: 池勝（fumitaka.ikekatsu@logiquest.co.jp）
