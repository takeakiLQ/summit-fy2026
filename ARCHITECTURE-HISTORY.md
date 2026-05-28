# 設計判断の経緯（Architecture History）

このドキュメントは、構成・技術選定の **「なぜそうなったか」** を記録する。コードの状態は README が正しいが、判断理由は時間が経つと忘れる・誤解される。新規参加者が「変な構成だな」と感じた時に、ここを読めば背景がわかる。

---

## Phase 1: 初期構築（Firebase 構成）

**期間**: 2026年5月初〜中旬

### 構成

```
Salesforce
   ↓ GitHub Actions（毎時0分）
Firebase Firestore（teams / members / deals / monthly_revenue / summary）
   ↓ Web SDK 直接アクセス
ブラウザ + Firebase Auth（Google）
   + Firebase Hosting（summit-fy2026.web.app）
```

### 選んだ理由

- **オールインワン**: DB + Auth + Hosting がワンセットで導入が速い
- **Web SDK直叩き**: バックエンドサーバーレスでフロントから直接Firestoreにアクセス可
- **無料枠**: Spark プランで完全無料を目指せた

### 問題が発生

ダッシュボード機能追加（特に「設定画面」「集計ロジック追加」）に伴い、**Firestore Spark プランの読取上限 50,000/日を超過**。

具体的な原因:
1. ダッシュボード1回開く＝3,500件読取（deals 579 + monthly_revenue 2,811 + 設定+メタ）
2. 設定画面で「保存」を押すたびに全件再ロード（初期実装の不備）
3. GitHub Actions の毎時同期で差分削除のため全件取得
4. 開発検証中の頻繁なリロード

結果: **2026/5/28 にクォータ超過 → 全Firestore操作が拒否される事態**。

---

## Phase 2: 軽量化（同日中の応急処置）

### 対応

| 施策 | 効果 |
|---|---|
| 集計サマリーを Firestore に事前生成 | 初回ロードの読取量を 3,500 → 数件に |
| 個人詳細をlazyロード | dealsの全件取得を不要に |
| sessionStorage キャッシュ（5分） | リロード時の読取をスキップ |
| 設定保存後の全件再ロードを撤去 | 約100倍の読取削減 |
| GitHub Actions の同期頻度 6時間ごとに削減 | Actions側読取を 14,000 → 2,400/日 |

これで「軽量化後の Firestore Spark でも回せる」状態にはなった。

しかし、ユーザーが「**Cloudflare に切り替えれば、軽量化なしでも完全無料枠で動くのでは？**」と気付き、Phase 3へ。

---

## Phase 3: Cloudflare 移行

**時期**: 2026年5月28日

### 移行先の構成

```
Salesforce
   ↓ GitHub Actions
Cloudflare D1（SQLite）
   ↓ Workers (Pages Functions)
ブラウザ + Firebase Auth（認証だけ残す）
   + Cloudflare Pages（summit-fy2026.pages.dev）
```

### なぜ Cloudflare D1 か

無料枠の比較:

| サービス | 日次読取上限 | 5月28日のピーク使用量 |
|---|---|---|
| Firebase Firestore（Spark） | 50,000件 | **520% 超過** |
| **Cloudflare D1** | **5,000,000行** | 5% 程度 |

→ **D1なら同じ使い方でも 100倍の余裕**。軽量化施策は引き続き有効なので、実際は無料枠の数%で運用できる。

### なぜ Firebase Auth は残したか

- **認証のみ**なら Firebase Spark プランで無制限・無料
- 既存のGoogleログイン体験（社員はGoogle Workspace）を変更したくなかった
- Cloudflare Access も検討したが、追加設定が複雑で、ユーザーから「Access設定したくない」と要望
- → Firebase ID Token を Workers の middleware で検証する方式に。`identitytoolkit.googleapis.com` の REST API で検証

### Cloudflare Pages の Direct Upload と Git 連携

最初は `wrangler pages deploy` で手動デプロイ（Direct Upload モード）でプロジェクトを作成した。後から「Git連携で自動デプロイにしたい」と思っても、**Direct Upload モードは後から Git連携に切替不可**。

→ Cloudflare Pages の Git 連携をやめて、**GitHub Actions の中で `wrangler pages deploy` を呼ぶ方式** に変更。これで自動デプロイ達成。

---

## Phase 4: 案件種別（ByQ / Qhai）対応

**時期**: 2026年5月28日

### 背景

Salesforce 案件の `Group_FY22__c` が `都市物流営業部（緊急便）` の案件は別チャネル（ByQ）。これまでQhai CSVには含まれていなかったが、ByQ用の実績CSVが別途存在する。

### 設計判断

- **担当者はサミット20名と被る**（ユーザー確認済み） → SF SOQL は今まで通り
- **`deals.kind` カラム**で 'ByQ' / 'Qhai' を保持（Group_FY22__c で判定）
- **CSV取込はファイル名で自動判別**（`ByQ_*.csv` / `Q配_*.csv`）
- **ByQマニュアル番号「97740-1」はハイフン以降を切り捨て**して SF Manual__c=「97740」と突合
- **同一案件・同一月の売上は合算**（ByQ CSVはコース別に複数行ある）
- **`monthly_revenue.kind`** も持ち、ヘッダで `Qhai: 2025-04〜2026-04 / ByQ: 2025-04〜2026-04` のように種別別月範囲を表示

---

## Phase 5: 共同開発体制

**時期**: 2026年5月28日

### 進めた施策

- **GitHub Actions の自動デプロイ**（`deploy.yml`）: main push → Cloudflare Pages
- **PR時のプレビューデプロイ**: feature ブランチで PR → 一時URLが自動コメント
- **ブランチ保護ルール**: main 直 push 禁止、PR + Approval 1 必須
- **README + DEVELOPMENT + ARCHITECTURE-HISTORY** の三層ドキュメント整備
- **Collaborator 追加**: 池勝（fumitaka.ikekatsu）

---

## 個別の設計判断メモ

### admin ロールの扱い

最初は「admin はランキング集計から一律除外」にしていたが、その後「**メンバー兼admin（T1〜T4所属の admin）は研修対象として集計に含めるべき**」という要件が判明。

修正: **所属チームの active で判定する**ように変更。
- T1〜T4所属（active=true）の admin → 集計に含める
- 本部チーム所属（active=false）の admin / member → 集計対象外

### 集計の「年度内完結」ルール

実績売上は **案件獲得年度内のみ**集計する。たとえばFY2025獲得の案件が2026/4に売上計上されても、FY2026の集計には含めず、FY2025に積む。

理由: 「研修期間中の評価」を獲得時点で確定させたいというユーザー要件。

実装: `_aggregate.ts` の `computeFinancials` で `yearMonthToFY(record.yearMonth) === yearMonthToFY(deal.yearMonth)` の条件をかける。

### ヘッダーのスティッキー化

`<div class="topbar-wrapper">` で header + nav + filter-bar をラップし、`position: sticky; top: 0` を当てる。これで個人別タブで20人のリストをスクロールしても、年度・期間ピルが常に手元にある状態。

### Chart.js の描画タイミング

タブ切替直後の `display: none → block` 直後に Chart.js を初期化すると、キャンバスサイズが 0 でレンダリング失敗することがあった。`requestAnimationFrame × 2` でブラウザのレイアウト計算完了後に初期化する形に修正。

---

## 教訓

1. **無料枠は事前に試算する**: 機能追加でクォータが何倍になるかを意識する
2. **読取・書込のホットパスに注意**: 設定保存後の全件再ロードのような「単純なバグ」が致命的なクォータ超過を招く
3. **データ層と認証層は別物**: Firebase Auth だけ残してDBを移行する選択肢は柔軟性が高い
4. **Pages の作成モードは慎重に選ぶ**: Direct Upload と Git連携は後から切替不可
5. **「admin」のような属性で機能を分岐するときは、判定軸が複数あることを想定する**: ロール・所属・有効状態など、何で判定するべきかを明確に
