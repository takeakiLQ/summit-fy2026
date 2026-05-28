/**
 * Firestore からデータを読み込み、ダッシュボードの期待形式に変換する。
 *
 * 軽量化後の方針:
 * - 初回ロード時は summary/aggregate (1ドキュメント) + teams + members + settings + meta だけ取得
 * - deals / monthly_revenue は **取得しない**（個人詳細クリック時に lazy load）
 * - 読取数: 旧 ~3,500件 → 新 ~30件（100倍以上の改善）
 *
 * 完了時に window.__SUMMARY__, __DEALS__(=null), __FINANCIALS__(=null) をセットして
 * window.dispatchEvent(new Event('summit-data-ready')) を発火する。
 */
import {
  getFirestore, collection, getDocs, doc, getDoc, query, where,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

// ----- セッションキャッシュ -----
const CACHE_KEY = 'summit_data_cache_v2'; // v2: 軽量化アーキテクチャ用にキャッシュキーを更新
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分

function loadCache() {
  try {
    const s = sessionStorage.getItem(CACHE_KEY);
    if (!s) return null;
    const o = JSON.parse(s);
    if (!o.savedAt || (Date.now() - o.savedAt) > CACHE_TTL_MS) return null;
    return o.data;
  } catch { return null; }
}
function saveCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (e) { console.warn('cache save failed:', e); }
}
function clearCache() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch {}
}
window.__CLEAR_DATA_CACHE__ = clearCache;

// ----- メイン -----
async function fetchAll(db, name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
}

async function loadData(opts = {}) {
  const overlay = document.createElement('div');
  overlay.id = 'data-loading';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(247,249,252,0.9);z-index:5000;display:flex;align-items:center;justify-content:center;font-family:"Yu Gothic","Hiragino Sans",sans-serif;';
  overlay.innerHTML = '<div style="text-align:center"><div style="font-size:32px;margin-bottom:12px">📡</div><div style="font-size:14px;color:#2E5C8A;font-weight:600">Firestoreからデータ読込中...</div><div id="data-loading-msg" style="font-size:11px;color:#6B7280;margin-top:8px"></div></div>';
  document.body.appendChild(overlay);
  const setMsg = (m) => { const e = document.getElementById('data-loading-msg'); if (e) e.textContent = m; };

  const db = getFirestore(getApp());

  // セッションキャッシュ判定
  let cached = null;
  if (!opts.forceRefresh) {
    cached = loadCache();
    if (cached) {
      setMsg('キャッシュから復元中...');
      console.info('[data-loader] sessionStorage キャッシュ使用（Firestore読取スキップ）');
    }
  }

  // ① summary/aggregate を読む（1ドキュメントで全集計）
  setMsg('集計サマリー取得中...');
  let summaryDoc = cached ? cached.summaryDoc : null;
  if (!cached) {
    const sd = await getDoc(doc(db, 'summary', 'aggregate'));
    if (sd.exists()) {
      const d = sd.data();
      summaryDoc = {
        computedAt: d.computedAt && d.computedAt.toDate ? d.computedAt.toDate().toISOString() : null,
        aggregate: d.aggregate || null,
        aggregateByPeriod: d.aggregateByPeriod || {},
        aggregateByFiscalYear: d.aggregateByFiscalYear || {},
        activeMemberCount: d.activeMemberCount || 0,
        activeTeamCount: d.activeTeamCount || 0,
        sourceDeals: d.sourceDeals || 0,
        totalDeals: d.totalDeals || 0,
      };
    }
  }

  // ② teams + members（数十件、設定画面用）
  setMsg('チーム・メンバー取得中...');
  const teamsRaw = cached ? cached.teamsRaw : await fetchAll(db, 'teams');
  const membersRaw = cached ? cached.membersRaw : await fetchAll(db, 'members');
  const activeTeams = teamsRaw.filter(t => t.active !== false);
  const activeMembers = membersRaw.filter(m => m.active !== false);

  // ③ settings + meta（数件）
  setMsg('設定取得中...');
  const settingsKpiData = cached ? cached.settingsKpiData
    : ((await getDoc(doc(db, 'settings', 'kpi'))).data() || {});
  let metaData = cached ? cached.metaData : null;
  if (!cached) {
    const md = await getDoc(doc(db, 'meta', 'sync_status'));
    if (md.exists()) {
      metaData = {
        lastSfSync: md.data().lastSfSync && md.data().lastSfSync.toDate
          ? md.data().lastSfSync.toDate().toISOString() : null,
      };
    }
  }

  // ④ ユーザーロール（自分自身のmemberドキュメント1件）
  setMsg('ユーザーロール取得中...');
  const auth = getAuth();
  let userRole = cached && cached.userRole ? cached.userRole : 'member';
  if (!cached && auth.currentUser && auth.currentUser.email) {
    const myDoc = await getDoc(doc(db, 'members', auth.currentUser.email));
    if (myDoc.exists() && myDoc.data().role === 'admin') userRole = 'admin';
  }

  // キャッシュ書込
  if (!cached) {
    saveCache({
      summaryDoc, teamsRaw, membersRaw, settingsKpiData, metaData, userRole,
    });
  }

  setMsg('完了');

  // ----- 既存ダッシュボードへの互換 window 変数を組み立てる -----
  const summary = summaryDoc ? {
    computedAt: (metaData && metaData.lastSfSync) || summaryDoc.computedAt || null,
    settings: settingsKpiData,
    aggregate: summaryDoc.aggregate || emptyAgg(),
    aggregateByPeriod: summaryDoc.aggregateByPeriod || {},
    aggregateByFiscalYear: summaryDoc.aggregateByFiscalYear || {},
  } : {
    // summary未生成の場合のフォールバック
    computedAt: metaData && metaData.lastSfSync ? metaData.lastSfSync : null,
    settings: settingsKpiData,
    aggregate: emptyAgg(),
    aggregateByPeriod: {},
    aggregateByFiscalYear: {},
  };

  window.__SUMMARY__ = summary;
  // deals / financials は初回ロードでは取得しない（個人詳細クリック時に lazy load）
  window.__DEALS__ = { deals: [], _lazy: true };
  window.__FINANCIALS__ = { matchedRows: [], _lazy: true };
  window.__TEAMS__ = activeTeams.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  window.__MEMBERS__ = activeMembers;
  window.__TEAMS_ALL__ = teamsRaw;
  window.__MEMBERS_ALL__ = membersRaw;
  window.__USER_ROLE__ = userRole;
  window.__USER_EMAIL__ = auth.currentUser ? auth.currentUser.email : null;

  overlay.remove();
  window.dispatchEvent(new Event('summit-data-ready'));
}

function emptyAgg() {
  return {
    totalPoint: 0, totalDeals: 0, totalIssues: 0,
    members: [], teams: [], monthly: [],
    rankings: { individual: [], team: [] },
  };
}

// ----- Lazy load API (個人詳細・案件詳細用) -----

/**
 * 特定メンバーの案件一覧を取得（whereクエリ、数件〜数十件のみ読取）
 * @param {string} ownerName
 * @param {string|null} ownerEmail
 * @returns {Promise<Array>} 案件配列
 */
window.__LOAD_PERSON_DEALS__ = async function(ownerName, ownerEmail) {
  const db = getFirestore(getApp());
  const dealsCol = collection(db, 'deals');
  // ownerEmail優先、なければownerNameでwhere
  const q = ownerEmail
    ? query(dealsCol, where('ownerEmail', '==', ownerEmail))
    : query(dealsCol, where('ownerName', '==', ownerName));
  const snap = await getDocs(q);
  const deals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.info('[lazy] ' + (ownerEmail || ownerName) + ' の案件 ' + deals.length + ' 件を取得');
  return deals;
};

/**
 * 特定メンバーの実績（monthly_revenue）を取得
 * @param {string} ownerName
 * @returns {Promise<Array>} 実績行配列
 */
window.__LOAD_PERSON_FINANCIALS__ = async function(ownerName) {
  const db = getFirestore(getApp());
  const col = collection(db, 'monthly_revenue');
  const q = query(col, where('ownerName', '==', ownerName));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.info('[lazy] ' + ownerName + ' の実績 ' + rows.length + ' 行を取得');
  return rows;
};

/**
 * 特定案件1件を取得
 */
window.__LOAD_DEAL__ = async function(dealId) {
  const db = getFirestore(getApp());
  const d = await getDoc(doc(db, 'deals', dealId));
  return d.exists() ? { id: d.id, ...d.data() } : null;
};

/**
 * 特定案件の実績行を取得
 */
window.__LOAD_DEAL_FINANCIALS__ = async function(dealId) {
  const db = getFirestore(getApp());
  const col = collection(db, 'monthly_revenue');
  const q = query(col, where('dealId', '==', dealId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 認証完了後にデータを取得
window.addEventListener('summit-auth-ready', () => {
  loadData().catch(err => {
    console.error('Firestoreデータ取得失敗:', err);
    const o = document.getElementById('data-loading');
    if (o) o.innerHTML = '<div style="text-align:center"><div style="font-size:14px;color:#DC2626">データ読込失敗: ' + (err.message || err) + '</div></div>';
  });
});

// 設定画面からの再ロードAPI
window.__DATA_RELOADER__ = async () => {
  await loadData({ forceRefresh: true });
};

// 軽量版: teams + members だけ再取得
window.__RELOAD_TEAMS_MEMBERS__ = async () => {
  const db = getFirestore(getApp());
  const teamsRaw = await fetchAll(db, 'teams');
  const membersRaw = await fetchAll(db, 'members');
  const activeTeams = teamsRaw.filter(t => t.active !== false);
  const activeMembers = membersRaw.filter(m => m.active !== false);
  window.__TEAMS__ = activeTeams.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  window.__MEMBERS__ = activeMembers;
  window.__TEAMS_ALL__ = teamsRaw;
  window.__MEMBERS_ALL__ = membersRaw;
};
