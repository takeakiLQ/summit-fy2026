# csv-import — 月別売上・粗利 CSV 取込モジュール

サミット営業成績ダッシュボードの財務データ取込モジュール。月次の売上実績 CSV を読み込み、`sf-extract` の出力 deals JSON と **マニュアル番号** で突合します。

## 役割

```
[Salesforce]                  [手動アップロードCSV]
    ↓ sf-extract                 ↓ csv-import  ★このモジュール
[deals-*.json]              [import-*.json]
    └────────────┬──────────┘
                  ↓ (マニュアル番号で結合)
              [統合データ]
                  ↓
            kpi-compute / ダッシュボード
```

## 動作要件

- Node.js 20 以上
- 取込 CSV（標準形式）
- sf-extract の出力 JSON（manualNo フィールドを含むもの）

## CSV 仕様

| カラム名 | 例 | 説明 |
|---|---|---|
| 配送年月 | "202604" | YYYYMM 形式（クオート可） |
| マニュアル番号 | 3 | SF の `Manual__c` と突合 |
| 売上合計 | 51653.00 | 売上として使用 |
| 原価合計 | 20614.00 | （未使用、参考） |
| CP用原価合計 | 41014.00 | 粗利計算に使用 |
| 稼働日数 | 5 | 参考情報 |

**計算式:**
- 売上 = 売上合計
- **粗利 = 売上合計 − CP用原価合計**

エンコーディング: UTF-8（BOM 有無どちらも可）。Shift-JIS の場合は `config/csv-mapping.json` の `encoding` を変更。

## セットアップ

```powershell
cd D:\Claude\トップ営業研修（サミット）\csv-import
npm install
```

## 実行

**事前準備**: sf-extract を最新版で再実行して manualNo を含む deals JSON を生成しておく。

```powershell
cd ..\sf-extract
npm run extract -- --out output/deals-with-manual.json
```

CSV 取込:

```powershell
cd ..\csv-import
npm run import -- --csv "../csv-samples/Q配_CP用売上実績_202604.csv" --deals "../sf-extract/output/deals-with-manual.json"
```

オプション省略時の自動検出:
- `--deals` を省略すると、`../sf-extract/output/` から最新の `deals-*.json` を自動選択

## 出力

`output/import-YYYYMMDD-HHMMSS.json` に以下を出力:

```json
{
  "importedAt": "ISO日時",
  "sourceFile": "...",
  "totalRows": 5745,
  "matched": 18,
  "unmatched": 5727,            // CSV側で対象外マニュアル
  "matchedRows": [
    { "yearMonth": "2026-04", "manualNo": "3",
      "revenue": 51653, "grossProfit": 10639,
      "dealId": "a28RC...", "dealName": "...",
      "ownerName": "北 憲治", "teamId": "T1", "matched": true }
  ],
  "unmatchedManualNos": ["100", "200", ...],  // サミット対象外（想定通り）
  "unmatchedDeals": [],         // 4月稼働開始だがCSVに無い案件
  "totals": {
    "revenue": 12345678,
    "grossProfit": 3456789,
    "byTeam": { "T1": { "revenue": ..., "grossProfit": ..., "deals": ... } },
    "byMember": { ... }
  }
}
```

## ファイル構成

```
csv-import/
├── package.json
├── tsconfig.json
├── README.md
├── .gitignore
├── config/
│   └── csv-mapping.json    CSVヘッダ名 → 論理名のマッピング
└── src/
    ├── index.ts            CLIエントリ
    ├── types.ts            型定義
    └── parse.ts            CSVパーサー（UTF-8 BOM対応）
```

## トラブルシューティング

### `突合成功: 0件` になる

`sf-extract` を Manual__c 追加後のバージョンで再実行していない可能性。`deals-*.json` を開いて `"manualNo"` フィールドがあることを確認してください。無ければ sf-extract を再実行。

### CSV 行数は読めるが日本語カラム名が見つからないと言われる

CSV のヘッダーが想定と異なる。`config/csv-mapping.json` で実カラム名に合わせて編集してください。

### 文字化け

`config/csv-mapping.json` の `encoding` を `shift-jis` などに変更（ただし現状は UTF-8 のみ対応）。Shift-JIS CSV は予め UTF-8 に変換するか、要望があれば対応を追加します。

## 次のステップ

- 統合: kpi-compute と csv-import の出力を合わせる「join」モジュール
- 複数月対応: 4月、5月... と毎月のCSVを蓄積してダッシュボードに反映
- 自動取込: Cloudflare Workers + R2 + D1 で本実装版
