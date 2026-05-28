# Firebase デプロイ手順書（Step 1）

サミット営業成績ダッシュボードを Firebase Hosting + Authentication で公開する手順。プロジェクト `summit-fy2026` 前提です。

## 全体の流れ（30 分程度）

1. Firebase Console で Web アプリ登録・認証設定（15 分）
2. ローカルで firebase-tools セットアップ（5 分）
3. デプロイ（5 分）
4. 動作確認（5 分）

---

## Step 1.1 Firebase Console での設定

### A. Web アプリの登録

1. https://console.firebase.google.com/project/summit-fy2026/overview にアクセス
2. 「**ウェブ</>**」のアイコンをクリック（プロジェクト概要画面の上部）
3. アプリのニックネーム: `summit-dashboard`
4. 「**このアプリの Firebase Hosting も設定する**」にチェック
5. 「**アプリを登録**」をクリック
6. 表示される **firebaseConfig オブジェクト** をコピー（次の B で使う）

```javascript
// このような構造が出る
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "summit-fy2026.firebaseapp.com",
  projectId: "summit-fy2026",
  storageBucket: "summit-fy2026.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123..."
};
```

### B. firebase-config.js に値を反映

`dashboard/firebase-config.js` を開いて、`REPLACE_ME` を A でコピーした値に置き換えてください。

```javascript
window.__FIREBASE_CONFIG__ = {
  apiKey: "AIzaSy...",                              // ← 貼り付け
  authDomain: "summit-fy2026.firebaseapp.com",
  projectId: "summit-fy2026",
  storageBucket: "summit-fy2026.appspot.com",
  messagingSenderId: "123456789012",                // ← 貼り付け
  appId: "1:123456789012:web:..."                   // ← 貼り付け
};
```

### C. Authentication の設定

1. Firebase Console 左メニュー → **構築 → Authentication**
2. 「**始める**」をクリック
3. 「**Sign-in method**」タブで「**Google**」を選択
4. 「有効にする」をオン、サポートメールを設定して保存
5. 「**Settings**」タブ → 「**承認済みドメイン**」
   - `localhost` と `summit-fy2026.web.app` がデフォルトで入っているはず
   - 後で独自ドメインを使う場合はここに追加

---

## Step 1.2 ローカルで firebase-tools を入れる

PowerShell で以下を実行:

```powershell
# firebase-tools をグローバルインストール
npm install -g firebase-tools

# Google アカウントでログイン（ブラウザが開く）
firebase login

# プロジェクト関連付け確認
cd D:\Claude\トップ営業研修（サミット）\dashboard
firebase projects:list
# → summit-fy2026 が表示されれば OK
```

---

## Step 1.3 デプロイ

```powershell
cd D:\Claude\トップ営業研修（サミット）\dashboard
firebase deploy --only hosting
```

実行すると次のような出力が出ます:

```
✔  Deploy complete!

Project Console: https://console.firebase.google.com/project/summit-fy2026/overview
Hosting URL: https://summit-fy2026.web.app
```

**Hosting URL** が公開先です。

---

## Step 1.4 動作確認

1. ブラウザで `https://summit-fy2026.web.app` を開く
2. **Google ログイン画面**が表示される
3. **logiquest.co.jp のメアドでログイン** → ダッシュボードが表示
4. **別ドメインのメアド**でログイン → 「許可されていないメアドです」エラーが出てログイン拒否される

---

## トラブルシューティング

### `Firebase未設定` のメッセージが出る

`firebase-config.js` の `apiKey: "REPLACE_ME"` を実際の値に置き換えていない。Step 1.1-B を再確認。

### Google ログイン後に何も起きない

ブラウザの開発者ツール (F12) の Console を見て、エラーメッセージを確認。
- `auth/unauthorized-domain` → Firebase Console の Authentication → 承認済みドメインに `summit-fy2026.web.app` が入っているか確認
- `Cross-Origin-Opener-Policy` 警告 → 機能には影響しない、無視して OK

### Google ログインしたのにダッシュボードが見えない

許可ドメイン外のメアドでログインしている。`firebase-config.js` の `__ALLOWED_DOMAINS__` に該当ドメインを追加するか、`logiquest.co.jp` のアカウントでログインし直す。

### `firebase deploy` で `Error: Failed to get Firebase project`

`firebase use summit-fy2026` を実行してプロジェクトを切り替え。

---

## 次のステップ（Step 2）

Firestore を導入してデータ永続化を実装します:

1. Firebase Console で Firestore を有効化
2. データモデル設計（teams, members, deals, monthly_revenue, settings）
3. ローカル `sf-extract` / `kpi-compute` / `csv-import` に Firestore 書き込み機能を追加
4. ダッシュボードを Firestore 読み込みに切り替え（リアルタイム反映）
5. CSV 取込画面の「取込実行」ボタンを Firestore 書き込みで実装

Step 2 完了後は GitHub Actions Cron による完全自動化（Step 3）に進めます。
