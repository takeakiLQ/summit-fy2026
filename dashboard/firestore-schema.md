# Firestore スキーマ設計（Step 2）

サミット営業成績ダッシュボード用 Firestore コレクション構造。プロジェクト: `summit-fy2026`

## 全体イメージ

```
summit-fy2026 (Firestore)
├── teams/                         ← 4 チーム（マスタ）
│   ├── T1
│   ├── T2
│   ├── T3
│   └── T4
├── members/                       ← 20 名（マスタ）
│   ├── koji.imai@logiquest.co.jp
│   └── ...
├── deals/                         ← Salesforce案件（同期される）
│   ├── a28RC00000... (Salesforce ID)
│   └── ...
├── monthly_revenue/               ← 月別売上・粗利（CSV由来）
│   ├── 2025-04_a28RC00000... (yearMonth_dealId)
│   └── ...
├── settings/                      ← KPI設定値
│   ├── kpi
│   ├── filters
│   └── allowed_domains
├── meta/                          ← 同期状態
│   └── sync_status
└── audit_log/                     ← 操作ログ
    └── (auto-id)
```

## 各コレクションの詳細

### teams/{teamId}

```json
{
  "id": "T1",
  "name": "富士",
  "color": "#FFB3B3",
  "sortOrder": 1,
  "createdAt": <timestamp>,
  "updatedAt": <timestamp>
}
```

### members/{email}

ドキュメントID = メアド（@ や . が含まれるが Firestore は受け入れる）。

```json
{
  "email": "koji.imai@logiquest.co.jp",
  "name": "今井 浩二",
  "team": "T1",
  "role": "member",         // 'member' or 'admin'
  "active": true,
  "createdAt": <timestamp>,
  "updatedAt": <timestamp>
}
```

### deals/{dealId}

Salesforce 案件ID をそのままドキュメントID に使う。

```json
{
  "id": "a28RC00000JwDEuYAN",
  "name": "東邦薬品株式会社京都営業所：９：RT（徳田）",
  "manualNo": "12345",
  "ownerName": "北 憲治",
  "ownerEmail": "kenji.kita@logiquest.co.jp",
  "ownerNameRaw": "...",
  "ownerEmailRaw": "...",
  "teamId": "T1",
  "msKbn": "main",
  "msKbnRaw": "メイン",
  "monthlyRevenue": 406000,
  "contractPrice": 20300,
  "monthlyWorkdays": 20,
  "dailyHours": 9,
  "status": "配車済み",
  "classification": "増車",
  "operationStartDate": "2026-05-12",
  "plannedStartDate": null,
  "registeredAt": <timestamp>,
  "lastModifiedAt": <timestamp>,
  "yearMonth": "2026-05",
  "fiscalYear": "FY2026",
  // KPI計算結果
  "hourlyRate": 2256,
  "hourlyCoef": 1.0,
  "basePoint": 1.0,
  "point": 1.0,
  "hasIssue": false,
  "issues": [],
  // 同期メタ
  "syncedAt": <timestamp>
}
```

### monthly_revenue/{yearMonth_dealId}

ドキュメントID = `2025-04_a28RC00000JwDEuYAN` 形式。これで同月＋同案件の UPSERT が決定論的に動く。

```json
{
  "yearMonth": "2025-04",
  "fiscalYear": "FY2025",
  "dealId": "a28RC00000JwDEuYAN",
  "manualNo": "12345",
  "ownerName": "北 憲治",
  "teamId": "T1",
  "revenue": 51653,
  "grossProfit": 10639,
  "workdays": 5,
  "uploadedAt": <timestamp>,
  "uploadedBy": "takeaki.mandokoro@logiquest.co.jp",
  "sourceFile": "Q配_CP用売上実績_202504.csv"
}
```

### settings/{key}

シングルトン的に複数設定値を保持。

```
settings/kpi:
  {
    msPoints: { main: 1.0, sub: 0.5 },
    hourlyCoefThresholds: [
      { min: 4000, coef: 2.0 },
      { min: 3000, coef: 1.5 },
      { min: 0, coef: 1.0 }
    ],
    issueRules: {...},
    updatedAt: <timestamp>,
    updatedBy: "..."
  }

settings/filters:
  {
    statusInclude: ["配車済み", "稼働終了"],
    classificationInclude: ["新規", "増車", "新増", "復活"],
    msKbnInclude: ["メイン", "サブ"],
    operationStartFrom: "2025-04-01"
  }

settings/allowed_domains:
  {
    domains: ["logiquest.co.jp", "qqbp.co.jp"]
  }
```

### meta/sync_status

```json
{
  "lastSfSync": <timestamp>,
  "lastSfSyncBy": "system|takeaki...",
  "lastSfSyncDeals": 350,
  "lastCsvImport": <timestamp>,
  "lastCsvImportBy": "...",
  "lastCsvImportMonths": ["2025-04", "2025-05", ...]
}
```

### audit_log/{auto-id}

```json
{
  "actor": "takeaki.mandokoro@logiquest.co.jp",
  "action": "csv_import",       // 'sf_sync', 'csv_import', 'settings_update', 'login' 等
  "target": "monthly_revenue/2025-04",
  "detail": { rows: 5745, monthsAffected: ["2025-04"] },
  "occurredAt": <timestamp>
}
```

## セキュリティルール

`firestore.rules` ファイルを作成して以下を設定。

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ヘルパー関数
    function isLoggedIn() {
      return request.auth != null;
    }
    function isAllowedDomain() {
      return isLoggedIn() &&
        (request.auth.token.email.matches('.*@logiquest\\.co\\.jp$') ||
         request.auth.token.email.matches('.*@qqbp\\.co\\.jp$'));
    }
    function isAdmin() {
      return isAllowedDomain() &&
        get(/databases/$(database)/documents/members/$(request.auth.token.email)).data.role == 'admin';
    }

    // メンバー一覧・チーム一覧・案件・実績・設定は全認証ユーザーが読み取り可
    match /teams/{id} {
      allow read: if isAllowedDomain();
      allow write: if isAdmin();
    }
    match /members/{email} {
      allow read: if isAllowedDomain();
      allow write: if isAdmin();
    }
    match /deals/{id} {
      allow read: if isAllowedDomain();
      allow write: if isAdmin();  // ローカルスクリプトはAdmin SDK経由なのでルール対象外
    }
    match /monthly_revenue/{id} {
      allow read: if isAllowedDomain();
      allow write: if isAdmin();  // 管理者だけCSV取込可能
    }
    match /settings/{id} {
      allow read: if isAllowedDomain();
      allow write: if isAdmin();
    }
    match /meta/{id} {
      allow read: if isAllowedDomain();
      allow write: if isAdmin();
    }
    match /audit_log/{id} {
      allow read: if isAdmin();
      allow create: if isAllowedDomain();
      allow update, delete: if false;
    }
  }
}
```

---

## Firestore 有効化手順（Step 2-A 実施事項）

### 1. データベース作成

1. https://console.firebase.google.com/project/summit-fy2026/firestore にアクセス
2. 「**データベースを作成**」をクリック
3. ロケーション: **`asia-northeast1` (東京)** を選択
4. セキュリティルール: **「本番モードで開始」** を選択（後で書き換えるが安全側で）
5. 「**有効化**」をクリック

### 2. サービスアカウント鍵を取得（Admin SDK用）

1. Firebase Console → 歯車 → **プロジェクトを設定**
2. **「サービスアカウント」** タブ
3. 「**新しい秘密鍵を生成**」→ JSON ファイルをダウンロード
4. ファイルを **D:\Claude\トップ営業研修（サミット）\firestore-sync\service-account.json** として保存
5. **このファイルは絶対に Git にコミットしないこと**（.gitignore で除外）

### 3. セキュリティルール反映

1. Firebase Console → Firestore Database → 「**ルール**」タブ
2. 上記のルールを貼り付け
3. 「**公開**」

### 4. テスト用初期データ投入（管理者を 1 名作成）

Firestore Console から手動で 1 件作成して、自分を admin にしておく:

- コレクション: `members`
- ドキュメントID: `takeaki.mandokoro@logiquest.co.jp`
- フィールド:
  - `email` (string): `takeaki.mandokoro@logiquest.co.jp`
  - `name` (string): `武明`
  - `team` (string): `admin`
  - `role` (string): `admin`
  - `active` (boolean): `true`

これで初期状態完成。

---

## 次のステップ（Step 2-B 以降）

- **2-B**: `firestore-sync` モジュール作成 → ローカル `kpi-compute` 結果を Firestore に書き込み
- **2-C**: ダッシュボードを Firestore 読み込みに切り替え
- **2-D**: CSV インポート画面の取込ボタンを実装

完了したら教えてください、次に進みます。
