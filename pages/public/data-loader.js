/**
 * Cloudflare Pages 版データローダー
 * - Firebase Auth で取得した IDトークンを Authorization: Bearer ヘッダに付けて Workers API を呼ぶ
 * - 初回ロード: GET /api/bootstrap（1リクエストで全部）
 * - 個人詳細クリック時のみ lazy load
 */

// セッション内キャッシュ
const CACHE_KEY = 'summit_cf_data_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

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
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data })); }
  catch (e) { console.warn('cache save failed:', e); }
}
function clearCache() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch {}
}
window.__CLEAR_DATA_CACHE__ = clearCache;

async function authHeaders() {
  const token = window.__GET_ID_TOKEN__ ? await window.__GET_ID_TOKEN__() : null;
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

async function apiGet(path) {
  const headers = await authHeaders();
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('GET ' + path + ' ' + res.status + ': ' + text.slice(0, 200));
  }
  return res.json();
}
async function apiSend(method, path, body) {
  const headers = await authHeaders();
  const res = await fetch(path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(method + ' ' + path + ' ' + res.status + ': ' + text.slice(0, 200));
  }
  return res.json();
}
window.__API_GET__ = apiGet;
window.__API_SEND__ = apiSend;

async function loadData(opts = {}) {
  let overlay = document.getElementById('data-loading');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'data-loading';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(247,249,252,0.9);z-index:5000;display:flex;align-items:center;justify-content:center;font-family:"Yu Gothic","Hiragino Sans",sans-serif;';
    overlay.innerHTML = '<div style="text-align:center"><div style="font-size:32px;margin-bottom:12px">📡</div><div style="font-size:14px;color:#2E5C8A;font-weight:600">データ読込中...</div><div id="data-loading-msg" style="font-size:11px;color:#6B7280;margin-top:8px"></div></div>';
    document.body.appendChild(overlay);
  }
  const setMsg = (m) => { const e = document.getElementById('data-loading-msg'); if (e) e.textContent = m; };

  let data;
  if (!opts.forceRefresh) {
    const cached = loadCache();
    if (cached) {
      setMsg('キャッシュから復元中...');
      data = cached;
    }
  }
  if (!data) {
    setMsg('Cloudflareから取得中...');
    data = await apiGet('/api/bootstrap');
    saveCache(data);
  }

  const summaryRaw = data.summary || {};
  const summary = {
    computedAt: (data.meta && data.meta.lastSfSync) || data.summaryComputedAt || null,
    settings: (data.settings && data.settings.kpi) || {},
    aggregate: summaryRaw.aggregate || emptyAgg(),
    aggregateByPeriod: summaryRaw.aggregateByPeriod || {},
    aggregateByFiscalYear: summaryRaw.aggregateByFiscalYear || {},
    financials: summaryRaw.financials || null,
    financialsByPeriod: summaryRaw.financialsByPeriod || {},
    financialsByFiscalYear: summaryRaw.financialsByFiscalYear || {},
    memberFinancials: summaryRaw.memberFinancials || {},
  };

  window.__SUMMARY__ = summary;
  window.__DEALS__ = { deals: [], _lazy: true };
  window.__FINANCIALS__ = { matchedRows: [], _lazy: true };
  window.__TEAMS_ALL__ = data.teamsAll || [];
  window.__MEMBERS_ALL__ = data.membersAll || [];
  window.__TEAMS__ = (data.teamsAll || []).filter(t => t.active).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  window.__MEMBERS__ = (data.membersAll || []).filter(m => m.active);
  window.__USER_ROLE__ = (data.user && data.user.role) || 'member';
  window.__USER_EMAIL__ = (data.user && data.user.email) || null;
  window.__USER_NAME__ = (data.user && data.user.name) || null;

  overlay.remove();
  window.dispatchEvent(new Event('summit-data-ready'));
}

function emptyAgg() {
  return { totalPoint: 0, totalDeals: 0, totalIssues: 0, members: [], teams: [], monthly: [], rankings: { individual: [], team: [] } };
}

window.__LOAD_PERSON_DEALS__ = async function(ownerName, ownerEmail) {
  const qs = ownerEmail ? '?owner=' + encodeURIComponent(ownerEmail) : '?ownerName=' + encodeURIComponent(ownerName);
  const data = await apiGet('/api/deals' + qs);
  return data.deals || [];
};
window.__LOAD_PERSON_FINANCIALS__ = async function(ownerName) {
  const data = await apiGet('/api/monthly-revenue?owner=' + encodeURIComponent(ownerName));
  return data.rows || [];
};
window.__LOAD_DEAL__ = async function(dealId) {
  const data = await apiGet('/api/deals/' + encodeURIComponent(dealId));
  return data.deal || null;
};
window.__LOAD_DEAL_FINANCIALS__ = async function(dealId) {
  const data = await apiGet('/api/monthly-revenue?deal=' + encodeURIComponent(dealId));
  return data.rows || [];
};

window.__DATA_RELOADER__ = async () => { clearCache(); await loadData({ forceRefresh: true }); };
window.__RELOAD_TEAMS_MEMBERS__ = async () => {
  const [t, m] = await Promise.all([apiGet('/api/teams'), apiGet('/api/members')]);
  window.__TEAMS_ALL__ = t.teams || [];
  window.__MEMBERS_ALL__ = m.members || [];
  window.__TEAMS__ = (t.teams || []).filter(x => x.active).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  window.__MEMBERS__ = (m.members || []).filter(x => x.active);
};

// 認証完了後にデータを取得
window.addEventListener('summit-auth-ready', () => {
  loadData().catch(err => {
    console.error('データ取得失敗:', err);
    const o = document.getElementById('data-loading');
    if (o) o.innerHTML = '<div style="text-align:center;padding:24px;background:white;border-radius:12px;max-width:480px"><div style="font-size:14px;color:#DC2626;font-weight:600;margin-bottom:8px">データ読込失敗</div><div style="font-size:12px;color:#6B7280">' + (err.message || err) + '</div></div>';
  });
});
