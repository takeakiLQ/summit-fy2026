# sf-extract — Salesforce 案件データ抽出モジュール

サミット営業成績ダッシュボードの前段モジュール。Node.js（ローカル）で動作し、Salesforce REST API から Deal__c（案件カスタムオブジェクト）を取得して JSON 出力する。

本モジュールは **読み取り専用**（SELECT 系の SOQL のみ）。Salesforce のデータを変更することはない。

---

## 動作要件

- Node.js 20 以上（fetch 内蔵）
- Salesforce 管理者権限（Connected App 作成権限）

## セットアップ手順

### 1. Connected App を作成（Salesforce 側の作業）

1. Salesforce 本番にログインし、**設定 → アプリケーション → アプリケーションマネージャ → 新規接続アプリケーション**
2. 基本情報を入力
   - 接続アプリケーション名: `サミット ダッシュボード sf-extract`
   - API 参照名: `Summit_Dashboard_sf_extract`
   - 取引先責任者メール: 管理者のメアド
3. **「OAuth 設定の有効化」** にチェック
4. コールバック URL: `http://localhost/oauth/callback`（Client Credentials Flow では使わないがダミー入力が必須）
5. **「クライアントログイン情報フローの有効化」** にチェック ★重要
6. 選択した OAuth 範囲:
   - `Manage user data via APIs (api)`
   - `Perform requests at any time (refresh_token, offline_access)`
7. **保存** → 警告が出るが「続行」
8. 作成後、アプリ詳細画面で「**コンシューマの詳細を表示**」をクリックして
   - **コンシューマ鍵** (Consumer Key) → `.env` の `SF_CLIENT_ID`
   - **コンシューマの秘密** (Consumer Secret) → `.env` の `SF_CLIENT_SECRET`

### 2. クライアントログイン情報フローの「実行者」を設定

1. 接続アプリケーション詳細画面 →「**管理**」ボタン → 「ポリシーを編集」
2. 「**クライアントログイン情報フロー**」セクションで、**「実行ユーザー」** に統合用のユーザーを指定
   - 推奨: 専用の「Integration User」を作成して指定（一般ユーザーや特権ユーザーは避ける）
   - そのユーザーが Deal__c に対する **「参照」権限** を持っていること
3. 保存

### 3. このリポジトリの設定

```bash
cd sf-extract
npm install

cp .env.example .env
# .env を編集して以下を入力:
#   SF_CLIENT_ID       コンシューマ鍵
#   SF_CLIENT_SECRET   コンシューマの秘密
#   SF_INSTANCE_URL    https://logiquest.my.salesforce.com（My Domain URL）
```

### 4. カラム API 名を確認

`config/columns.json` には実 SOQL から確認済みの API 名がすでに設定されている（`Oppotunities__c`、`PersoninCharge__r.Name`、`Item__c`、`Scheduled_sales_calculation__c`、`KADO_YOTEI_NISSUU_AUTO__c`、`Restraint_Time__c`、`OpputunityClassification__c` 等）。

確認が必要な項目:
- `fields.ownerEmail`: 空欄。PersoninCharge ルックアップ先（User か Person カスタム）に Email 項目があれば `PersoninCharge__r.Email` を設定すると SF からメアド取得可能。空のままでも members.json の氏名→メアド対応で補完される。
- `$msKbnValues.main` / `$msKbnValues.sub`: Item__c の実値が「メイン」「サブ」以外の文字列の場合に設定。

describe コマンドで Oppotunities__c の全フィールドと picklist 値を確認できる:

```bash
npm run extract -- --describe
```

### 5. メンバー名簿を確認

`config/members.json` には 4 チーム×19 名が初期登録されている。
チームやメンバーの追加・変更があればこのファイルを編集する。

---

## 実行

### 基本（過去 30 日の更新分を取得）

```bash
npm run extract
```

### 全件取得

```bash
npm run extract -- --all
# または
npm run extract:all
```

### 指定日以降の更新分

```bash
npm run extract -- --since 2026-01-01
```

### オブジェクトのフィールド一覧を確認（カラム名確認用）

```bash
npm run extract -- --describe
```

### 出力先を指定

```bash
npm run extract -- --out output/test.json
```

### デバッグログ

```bash
DEBUG=true npm run extract
```

---

## 出力フォーマット

`output/deals-YYYYMMDD-HHMMSS.json`

```json
{
  "exportedAt": "2026-05-27T08:00:00.000Z",
  "objectApiName": "Deal__c",
  "totalFetched": 25,
  "totalIncluded": 18,
  "totalExcluded": 7,
  "excludedReason": [
    { "reason": "本チーム員ではない", "count": 7 }
  ],
  "deals": [
    {
      "id": "a0X000000ABCD",
      "name": "株式会社A様 物流DX案件",
      "ownerEmail": "koji.imai@logiquest.co.jp",
      "ownerName": "今井 浩二",
      "teamId": "T1",
      "msKbnRaw": "メイン",
      "msKbn": "main",
      "monthlyRevenue": 1800000,
      "monthlyWorkdays": 20,
      "dailyHours": 8,
      "status": "進行中",
      "registeredAt": "2026-04-01T00:00:00.000+0000",
      "lastModifiedAt": "2026-05-15T03:21:11.000+0000",
      "raw": { ... 生のSFレスポンス ... }
    }
  ]
}
```

このJSONを後段のモジュール（KPI計算・D1取込）が消費する想定。

---

## ファイル構成

```
sf-extract/
├── package.json
├── tsconfig.json
├── .env.example          ← .env にコピーして使う
├── .gitignore
├── config/
│   ├── columns.json      ← Deal__c のカラムAPI名マッピング
│   └── members.json      ← 4チーム×19名の名簿
└── src/
    ├── index.ts          ← CLIエントリ
    ├── config.ts         ← 環境変数と設定ファイルのロード
    ├── auth.ts           ← Client Credentials Flow
    ├── sfClient.ts       ← SF REST APIクライアント
    ├── soql.ts           ← SOQLビルダー
    └── extractDeals.ts   ← 案件抽出ロジック（メンバーフィルタ・正規化）
```

---

## トラブルシューティング

### `invalid_client_id` エラー

`.env` の `SF_CLIENT_ID` が間違っている。Connected App の「コンシューマの詳細を表示」から再度コピー。Salesforce では Connected App 作成直後は反映に数分かかる場合があるので、5〜10分待ってから再試行。

### `invalid_grant: request not supported on this domain` エラー

Client Credentials Flow は **組織の My Domain URL** でのみ受け付けられる（login.salesforce.com では不可）。`.env` を以下のように修正:

```
SF_LOGIN_URL=https://<御社MyDomain>.my.salesforce.com
SF_INSTANCE_URL=https://<御社MyDomain>.my.salesforce.com
```

My Domain URL は、Salesforce ログイン後のブラウザのアドレスバー、または「設定 → 会社の設定 → 私のドメイン」で確認できる。

### `invalid_grant` エラー（その他）

「クライアントログイン情報フローの有効化」がオフ、または「実行ユーザー」が未設定の可能性。Connected App の「ポリシーを編集」を確認。

### `INVALID_FIELD: No such column 'XXX' on entity 'Deal__c'`

`config/columns.json` のフィールド名が実際の API 名と一致していない。
`npm run extract -- --describe` で正しい API 名を確認して `columns.json` を修正。

### Owner_Email__c が数式項目で SOQL の WHERE 句に使えない

数式項目を WHERE で使えないケースがある。クライアント側フィルタにフォールバック:

```bash
npm run extract -- --client-side-filter
```

### `INSUFFICIENT_ACCESS_OR_READONLY`

Connected App の「実行ユーザー」が Deal__c に対する参照権限を持っていない。プロファイルまたは権限セットで参照を許可する。

### API コール上限

Salesforce のライセンスごとに 24 時間あたりの API コール数上限がある。`--describe` を含めて 1 リクエスト 1 カウント。「設定 → 組織情報」で残量を確認可能。

---

## 次のステップ（後段モジュール）

このモジュールが安定稼働したら、以下のモジュールを追加で作る:

1. **kpi-compute**: この JSON を入力に、KPI ロジック（時間当たり単価×係数）を適用してポイント計算
2. **d1-sync**: 計算済みデータを Cloudflare D1 に UPSERT
3. **workers/cron**: Cloudflare Workers として上記をまとめ、毎時 Cron で実行

設計書は `../サミット営業成績ダッシュボード_要件・基本設計書_v1.1.docx` を参照。

---

## ライセンス・取扱い

本コードは社内利用限定。`.env` および `output/` 配下のJSONには案件情報が含まれるため、外部共有禁止。
