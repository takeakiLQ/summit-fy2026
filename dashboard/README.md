# dashboard — ダッシュボードプロトタイプ

サミット営業成績ダッシュボードの **HTML プロトタイプ**。`kpi-compute` の出力 `summary.json` をブラウザで可視化します。

## 動作要件

- ブラウザ（Chrome / Edge / Safari いずれも可）
- Node.js（`data.js` 生成スクリプトで使用）

## 使い方

### 1. データ更新

`kpi-compute` を先に実行しておく必要があります。

```powershell
# kpi-compute を実行（変更があった場合）
cd ..\kpi-compute
npm run compute -- --in ../sf-extract/output/deals-v2.json

# dashboard に戻って、最新の summary を data.js に同期
cd ..\dashboard
node sync-data.js
```

`node sync-data.js` を実行すると、`../kpi-compute/output/` 内の最新の `*_summary.json` を自動的に拾って `data.js` を生成します。

### 2. ブラウザで開く

`index.html` をダブルクリックして開くだけで OK です（ファイルプロトコル `file://` で動きます）。

または右クリック → 「Chrome で開く」など。

## 機能

### 全体ビュー（初期表示）

- KPI ボックス（合計ポイント / 案件数 / 参加メンバー / 要修正案件）
- チームランキングのカード（パステルカラー）
- チーム比較棒グラフ
- 個人ランキング TOP10

### チーム別ビュー

- 全 4 チームのカード（クリックで詳細）

### 個人別ビュー

- 全メンバーのランキング表

### 月別推移ビュー

- 月別のチーム別積み上げ棒グラフ
- 月 × チームの ピボットテーブル

### ドリルダウン

- チームカードをクリック → チーム詳細（月別推移ライングラフ + メンバー一覧）
- メンバー行をクリック → 個人詳細（係数内訳ドーナツチャート）

## デザイン

- パステル 4 色（T1 富士 #FFB3B3 / T2 立山 #A5D8FF / T3 剱 #B2F2BB / T4 白山 #FFD8A8）
- 16/32px ベースの角丸、薄いシャドウ
- モバイル対応（〜640px でグリッドが縦並びに）
- Chart.js（CDN）のみ外部依存

## ファイル構成

```
dashboard/
├── index.html      ← 開くだけで動く本体（HTML+CSS+JSをワンファイル）
├── data.js         ← sync-data.jsが生成（window.__SUMMARY__）
├── sync-data.js    ← summary.json → data.js 変換
└── README.md
```

## 本実装への移行

このプロトタイプは見た目と操作感の確認用です。本実装では:

- React + Vite で書き直し
- データソースを Cloudflare D1 / API に切替
- 認証（Google OAuth）追加
- 設定画面（管理者用）追加
- メアドフィルタを Cloudflare Pages にデプロイ

の方針です（要件・基本設計書 v1.1 に準拠）。

## トラブルシューティング

### 「データが読み込めません」と表示される

`data.js` が生成されていません。`node sync-data.js` を実行してください。

### グラフが表示されない

Chart.js を CDN から読み込んでいるため、初回はインターネット接続が必要です。一度ロードすればキャッシュされます。

### 日本語が文字化けする

ブラウザの文字コード自動判定がうまく行かない場合があります。Chrome なら問題ないはずですが、もし化ける場合は表示メニューから UTF-8 を指定してください。
