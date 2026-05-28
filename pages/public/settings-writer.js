/**
 * Cloudflare Pages 版 設定書込API（Firebase ID Token認証）
 */
async function authHeaders() {
  const token = window.__GET_ID_TOKEN__ ? await window.__GET_ID_TOKEN__() : null;
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}
async function send(method, path, body) {
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

window.__SETTINGS_WRITER__ = {
  upsertTeam: async (id, data) => send('PUT', '/api/teams/' + encodeURIComponent(id), data),
  addTeam: async (id, name, color, sortOrder) => send('POST', '/api/teams', { id, name, color, sortOrder }),
  upsertMember: async (email, data) => send('PUT', '/api/members/' + encodeURIComponent(email), data),
  addMember: async (name, email, team, role) => send('POST', '/api/members', { name, email, team, role: role || 'member' }),
};
