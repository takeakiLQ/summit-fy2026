# kpi-compute — KPI 計算・集計モジュール

サミット営業成績ダッシュボードの後段モジュール。`sf-extract` が出力した案件 JSON にポイント計算と集計を適用する。

## 役割

```
[Salesforce]
    ↓ sf-extract
[deals-*.json]  ← 案件データ（フィルタ済み）
    ↓ kpi-compute  ★このモジュール
[compute-*_deals.json]    案件ごとのポイント付き
[compute-*_summary.json]  メンバー・チーム・月別の集計
[compute-*_issues.json]   要修正案件一覧
    ↓ d1-sync（未実装）
[Cloudflare D1]
```

## 動作要件

- Node.js 20 以上
- `sf-extract` の出力 JSON（先にこちらを実行しておく）

## セットアップ

```powershell
cd D:\Claude\トップ営業研修（サミット）\kpi-compute
npm install
```

## 実行

```powershell
npm run compute -- --in ../sf-extract/output/deals-v2.json
```

出力先を指定:
```powershell
npm run compute -- --in ../sf-extract/output/deals-v2.json --out-base myrun
```

## KPI 計算ロジック

設計書 7 章のロジックを `config/kpi-settings.json` で可変設定として実装。

```
時間当たり単価 = monthlyRevenue / monthlyWorkdays / dailyHours
時間当たり係数 = 4,000円以上 ×2.0 / 3,000円以上 ×1.5 / 3,000円未満 ×1.0
獲得ポイント   = (メイン1.0 or サブ0.5) × 時間当たり係数
```

集計用の年月は `operationStartDate`（稼働開始日）優先、なければ `registeredAt`。

## 設定変更

`config/kpi-settings.json` を編集すれば、係数閾値・倍率・ポイント値・要修正案件のルールが変わります。コードは触らなくて OK。

```json
{
  "msPoints": { "main": 1.0, "sub": 0.5 },
  "hourlyCoefThresholds": [
    { "min": 4000, "coef": 2.0 },
    { "min": 3000, "coef": 1.5 },
    { "min": 0,    "coef": 1.0 }
  ],
  "issueRules": {
    "missingDailyHours": true,
    "missingMonthlyWorkdays": true,
    "missingMonthlyRevenue": true,
    "zeroDivisor": true,
    "extremeHourlyRateAbove": 100000,
    "extremeHourlyRateBelow": 100
  }
}
```

## 出力

### `{base}_deals.json`
各案件にポイント計算結果（`hourlyRate`, `hourlyCoef`, `basePoint`, `point`, `hasIssue`, `issues`, `yearMonth`）を付与。

### `{base}_summary.json`
- `aggregate.totalPoint` / `totalDeals` / `totalIssues`
- `aggregate.members[]`: メンバー別合計（ポイント、メイン/サブ件数、係数レンジ別件数）
- `aggregate.teams[]`: チーム別合計
- `aggregate.monthly[]`: 月別合計（チーム別内訳付き）
- `aggregate.rankings.individual[]`: 個人ランキング
- `aggregate.rankings.team[]`: チームランキング

### `{base}_issues.json`
要修正案件のみ抽出（`hasIssue=true`）。検出された問題（`issues`）と元データを含む。

## ファイル構成

```
kpi-compute/
├── package.json
├── tsconfig.json
├── README.md
├── .gitignore
├── config/
│   └── kpi-settings.json
└── src/
    ├── index.ts        CLIエントリ
    ├── config.ts       設定ロード
    ├── types.ts        sf-extract出力型 + 計算後型
    ├── compute.ts      KPI計算ロジック
    └── aggregate.ts    集計ロジック
```

## 次のステップ

- `d1-sync`: 計算結果を Cloudflare D1 に UPSERT
- ダッシュボードフロントエンド: `summary.json` を元に React で表示
