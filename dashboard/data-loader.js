/**
 * Firestore からデータを読み込み、ダッシュボードの期待形式に変換する。
 * 完了時に window.__SUMMARY__, __DEALS__, __FINANCIALS__ をセットして
 * window.dispatchEvent(new Event('summit-data-ready')) を発火する。
 */
import { getFirestore, collection, getDocs, doc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

// ----- ユーティリティ -----
function yearMonthToFY(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return 'FY' + (m >= 4 ? y : y - 1);
}
function coefLabel(coef) { return coef == null ? 'N/A' : 'x' + Number(coef).toFixed(1); }
function r2(n) { return Math.round(n * 100) / 100; }

// ----- 集計関数（kpi-compute の aggregate を再現） -----
function aggregate(deals) {
  const memberMap = new Map();
  for (const d of deals) {
    const key = d.ownerEmail || d.ownerName || 'unknown';
    if (!memberMap.has(key)) memberMap.set(key, {
      teamId: d.teamId || '?', ownerName: d.ownerName || '?', ownerEmail: d.ownerEmail || '',
      totalPoint: 0, mainCount: 0, subCount: 0, totalDeals: 0, issueCount: 0, coefBreakdown: {},
    });
    const m = memberMap.get(key);
    m.totalPoint += d.point || 0;
    m.totalDeals++;
    if (d.msKbn === 'main') m.mainCount++;
    if (d.msKbn === 'sub') m.subCount++;
    if (d.hasIssue) m.issueCount++;
    const cl = coefLabel(d.hourlyCoef);
    m.coefBreakdown[cl] = (m.coefBreakdown[cl] || 0) + 1;
  }
  for (const m of memberMap.values()) m.totalPoint = r2(m.totalPoint);

  const teamMap = new Map();
  for (const m of memberMap.values()) {
    if (!teamMap.has(m.teamId)) teamMap.set(m.teamId, {
      teamId: m.teamId, totalPoint: 0, mainCount: 0, subCount: 0,
      totalDeals: 0, memberCount: 0, issueCount: 0,
    });
    const t = teamMap.get(m.teamId);
    t.totalPoint += m.totalPoint;
    t.mainCount += m.mainCount;
    t.subCount += m.subCount;
    t.totalDeals += m.totalDeals;
    t.memberCount++;
    t.issueCount += m.issueCount;
  }
  for (const t of teamMap.values()) t.totalPoint = r2(t.totalPoint);

  const monthlyMap = new Map();
  for (const d of deals) {
    if (!d.yearMonth) continue;
    if (!monthlyMap.has(d.yearMonth)) monthlyMap.set(d.yearMonth, {
      yearMonth: d.yearMonth, totalPoint: 0, totalDeals: 0, byTeam: {}
    });
    const ma = monthlyMap.get(d.yearMonth);
    ma.totalPoint += d.point || 0;
    ma.totalDeals++;
    const t = d.teamId || '?';
    ma.byTeam[t] = (ma.byTeam[t] || 0) + (d.point || 0);
  }
  for (const ma of monthlyMap.values()) {
    ma.totalPoint = r2(ma.totalPoint);
    for (const k of Object.keys(ma.byTeam)) ma.byTeam[k] = r2(ma.byTeam[k]);
  }

  const members = Array.from(memberMap.values()).sort((a,b)=>b.totalPoint-a.totalPoint);
  const teams = Array.from(teamMap.values()).sort((a,b)=>b.totalPoint-a.totalPoint);
  const individualRanking = members.map((m,i)=>({rank:i+1,ownerName:m.ownerName,teamId:m.teamId,point:m.totalPoint,deals:m.totalDeals}));
  const teamRanking = teams.map((t,i)=>({rank:i+1,teamId:t.teamId,point:t.totalPoint}));

  const totalPoint = r2(deals.reduce((s,d)=>s+(d.point||0),0));
  const totalDeals = deals.length;
  const totalIssues = deals.filter(d=>d.hasIssue).length;

  return {
    totalPoint, totalDeals, totalIssues, members, teams,
    monthly: Array.from(monthlyMap.values()).sort((a,b)=>a.yearMonth.localeCompare(b.yearMonth)),
    rankings: { individual: individualRanking, team: teamRanking },
  };
}

function aggregateByMonth(deals) {
  const byM = {};
  for (const d of deals) {
    if (!d.yearMonth) continue;
    if (!byM[d.yearMonth]) byM[d.yearMonth] = [];
    byM[d.yearMonth].push(d);
  }
  const out = {};
  for (const k of Object.keys(byM)) out[k] = aggregate(byM[k]);
  return out;
}
function aggregateByFY(deals) {
  const byFy = {};
  for (const d of deals) {
    const fy = yearMonthToFY(d.yearMonth);
    if (!fy) continue;
    if (!byFy[fy]) byFy[fy] = [];
    byFy[fy].push(d);
  }
  const out = {};
  for (const k of Object.keys(byFy)) out[k] = aggregate(byFy[k]);
  return out;
}

// ----- メイン -----
async function fetchAll(db, name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
}

// セッション内キャッシュ（Firestoreの読取回数を抑えるため）
const CACHE_KEY = 'summit_data_cache_v1';
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

async function loadData(opts = {}) {
  const overlay = document.createElement('div');
  overlay.id = 'data-loading';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(247,249,252,0.9);z-index:5000;display:flex;align-items:center;justify-content:center;font-family:"Yu Gothic","Hiragino Sans",sans-serif;';
  overlay.innerHTML = '<div style="text-align:center"><div style="font-size:32px;margin-bottom:12px">📡</div><div style="font-size:14px;color:#2E5C8A;font-weight:600">Firestoreからデータ読込中...</div><div id="data-loading-msg" style="font-size:11px;color:#6B7280;margin-top:8px"></div></div>';
  document.body.appendChild(overlay);
  const setMsg = (m) => { const e = document.getElementById('data-loading-msg'); if (e) e.textContent = m; };

  const db = getFirestore(getApp());

  // セッションキャッシュをチェック（5分以内なら全コレクション取得をスキップ）
  let cached = null;
  if (!opts.forceRefresh) {
    cached = loadCache();
    if (cached) {
      setMsg('キャッシュから復元中...');
      console.info('[data-loader] sessionStorage キャッシュを使用（Firestore読取スキップ）');
    }
  }

  setMsg('チーム・メンバー取得中...');
  const teamsRaw = cached ? cached.teamsRaw : await fetchAll(db, 'teams');
  const membersRaw = cached ? cached.membersRaw : await fetchAll(db, 'members');

  // 非アクティブを完全除外（active未定義はtrueとみなす）
  const activeTeams = teamsRaw.filter(t => t.active !== false);
  const activeMembers = membersRaw.filter(m => m.active !== false);
  const activeTeamIds = new Set(activeTeams.map(t => t.id));
  const activeMemberEmails = new Set(activeMembers.map(m => m.email));
  const activeMemberNames = new Set(activeMembers.map(m => m.name));
  // 非アクティブチームに属するメンバーも除外
  const finalActiveEmails = new Set(activeMembers.filter(m => activeTeamIds.has(m.team)).map(m => m.email));
  const finalActiveNames = new Set(activeMembers.filter(m => activeTeamIds.has(m.team)).map(m => m.name));

  setMsg('案件データ取得中...');
  const dealsRawAll = cached ? cached.dealsRawAll : await fetchAll(db, 'deals');
  // 非アクティブメンバー/チームの案件を完全除外
  const dealsRaw = dealsRawAll.filter(d => {
    if (d.teamId && !activeTeamIds.has(d.teamId)) return false;
    // ownerEmail で照合（取れない場合は ownerName）
    if (d.ownerEmail) return finalActiveEmails.has(d.ownerEmail);
    if (d.ownerName) return finalActiveNames.has(d.ownerName);
    return false;
  });
  const excluded = dealsRawAll.length - dealsRaw.length;
  if (excluded > 0) console.info('[data-loader] 非アクティブ除外: ' + excluded + '件の案件をスキップ');

  setMsg('実績データ取得中...');
  const monthlyRawAll = cached ? cached.monthlyRawAll : await fetchAll(db, 'monthly_revenue');
  const monthlyRaw = monthlyRawAll.filter(r => {
    if (r.teamId && !activeTeamIds.has(r.teamId)) return false;
    if (r.ownerName && !finalActiveNames.has(r.ownerName)) return false;
    return true;
  });

  setMsg('設定取得中...');
  const settingsKpiData = cached ? cached.settingsKpiData
    : (await getDoc(doc(db, 'settings', 'kpi'))).data() || {};
  const metaData = cached ? cached.metaData
    : (() => {
        const s = (async () => {
          const d = await getDoc(doc(db, 'meta', 'sync_status'));
          return d.exists() ? { lastSfSync: d.data().lastSfSync ? d.data().lastSfSync.toDate().toISOString() : null } : null;
        })();
        return s;
      })();
  const metaDataResolved = cached ? cached.metaData : await metaData;

  setMsg('ユーザーロール取得中...');
  const auth = getAuth();
  let userRole = cached && cached.userRole ? cached.userRole : 'member';
  if (!cached && auth.currentUser && auth.currentUser.email) {
    const myDoc = await getDoc(doc(db, 'members', auth.currentUser.email));
    if (myDoc.exists() && myDoc.data().role === 'admin') userRole = 'admin';
  }

  // キャッシュ書き出し（重いコレクションを保存。次回は読まずに済む）
  if (!cached) {
    saveCache({
      teamsRaw, membersRaw, dealsRawAll, monthlyRawAll,
      settingsKpiData, metaData: metaDataResolved, userRole,
    });
  }

  setMsg('集計中...');

  // Firestore deals → kpi-compute出力形式に整形（yearMonth, point等は既に格納済み）
  const deals = dealsRaw.map(d => ({
    id: d.id || d._id,
    name: d.name, manualNo: d.manualNo,
    ownerName: d.ownerName, ownerEmail: d.ownerEmail,
    ownerNameRaw: d.ownerNameRaw, ownerEmailRaw: d.ownerEmailRaw,
    matchedBy: d.matchedBy, teamId: d.teamId,
    msKbnRaw: d.msKbnRaw, msKbn: d.msKbn,
    monthlyRevenue: d.monthlyRevenue, contractPrice: d.contractPrice,
    monthlyWorkdays: d.monthlyWorkdays, dailyHours: d.dailyHours,
    status: d.status, classification: d.classification,
    operationStartDate: d.operationStartDate, plannedStartDate: d.plannedStartDate,
    registeredAt: d.registeredAt, lastModifiedAt: d.lastModifiedAt,
    hourlyRate: d.hourlyRate, hourlyCoef: d.hourlyCoef,
    hourlyCoefLabel: d.hourlyCoefLabel, basePoint: d.basePoint,
    point: d.point, hasIssue: d.hasIssue, issues: d.issues,
    yearMonth: d.yearMonth,
  }));

  const summary = {
    computedAt: metaDataResolved && metaDataResolved.lastSfSync ? metaDataResolved.lastSfSync : null,
    settings: settingsKpiData,
    aggregate: aggregate(deals),
    aggregateByPeriod: aggregateByMonth(deals),
    aggregateByFiscalYear: aggregateByFY(deals),
  };

  const financialsMatched = monthlyRaw.map(r => ({
    yearMonth: r.yearMonth, manualNo: r.manualNo, dealId: r.dealId,
    revenue: r.revenue, grossProfit: r.grossProfit, workdays: r.workdays,
    ownerName: r.ownerName, teamId: r.teamId, matched: true,
  }));
  const financials = { matchedRows: financialsMatched };

  window.__SUMMARY__ = summary;
  window.__DEALS__ = { deals };
  window.__FINANCIALS__ = financials;
  window.__TEAMS__ = activeTeams.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  window.__MEMBERS__ = activeMembers;
  window.__TEAMS_ALL__ = teamsRaw;  // 非アクティブ含む全件（設定画面用）
  window.__MEMBERS_ALL__ = membersRaw;
  window.__USER_ROLE__ = userRole;
  window.__USER_EMAIL__ = auth.currentUser ? auth.currentUser.email : null;

  setMsg('完了');
  overlay.remove();
  window.dispatchEvent(new Event('summit-data-ready'));
}

// 認証完了後にデータを取得
window.addEventListener('summit-auth-ready', () => {
  loadData().catch(err => {
    console.error('Firestoreデータ取得失敗:', err);
    const o = document.getElementById('data-loading');
    if (o) o.innerHTML = '<div style="text-align:center"><div style="font-size:14px;color:#DC2626">データ読込失敗: ' + (err.message || err) + '</div></div>';
  });
});

// 設定画面からの再ロードAPI（重い・全件取得）
window.__DATA_RELOADER__ = async () => {
  await loadData();
};

// 軽量版: teams + members だけ再取得（数十件のみ、読取コストが低い）
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
