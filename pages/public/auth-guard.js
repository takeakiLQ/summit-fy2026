/**
 * Firebase Authentication ガード（Cloudflare Pages 版）
 *
 * - Googleアカウントでログイン
 * - 許可ドメインのみ通す
 * - ログイン後、ID Tokenを window.__GET_ID_TOKEN__ で取得できるようにする
 *   data-loader.js / settings-writer.js はこれを使って fetch の Authorization ヘッダに付ける
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const config = window.__FIREBASE_CONFIG__;
const allowedDomains = window.__ALLOWED_DOMAINS__ || [];

if (!config || !config.apiKey) {
  console.warn('Firebase未設定: firebase-config.js を確認してください');
}

const app = initializeApp(config);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ログイン画面オーバーレイ
function showLoginOverlay() {
  const existing = document.getElementById('auth-overlay');
  if (existing) return;
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#F7F9FC;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"Yu Gothic","Hiragino Sans",sans-serif;';
  overlay.innerHTML = `
    <div style="max-width:420px;text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.1);">
      <div style="font-size:48px;margin-bottom:12px">🏔</div>
      <h1 style="font-size:22px;font-weight:700;color:#2E5C8A;margin-bottom:8px">サミット営業成績ダッシュボード</h1>
      <p style="color:#6B7280;font-size:13px;margin-bottom:24px">社内専用システム。Googleアカウントでログインしてください。</p>
      <button id="btn-google-login" style="background:#2E5C8A;color:white;border:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px">
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#fff" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84c-.2 1.13-.85 2.08-1.81 2.72v2.26h2.92c1.71-1.57 2.69-3.89 2.69-6.63z"/><path fill="#fff" opacity=".7" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33C2.44 15.96 5.48 18 9 18z"/></svg>
        Googleでログイン
      </button>
      <p id="auth-error" style="color:#DC2626;font-size:12px;margin-top:16px;min-height:18px"></p>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('btn-google-login').addEventListener('click', async () => {
    try { await signInWithPopup(auth, provider); }
    catch (e) { document.getElementById('auth-error').textContent = 'ログイン失敗: ' + (e.message || e.code); }
  });
}
function hideLoginOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.remove();
}

function checkDomain(email) {
  if (!email) return false;
  if (allowedDomains.length === 0) return true;
  return allowedDomains.includes(email.split('@')[1]);
}

// IDトークン取得API
window.__GET_ID_TOKEN__ = async function() {
  const u = auth.currentUser;
  if (!u) return null;
  return await u.getIdToken();
};
window.__AUTH__ = { auth, signOut };

// 初期はメインを隠す
document.documentElement.style.visibility = 'hidden';

onAuthStateChanged(auth, async user => {
  if (!user) {
    document.documentElement.style.visibility = 'visible';
    showLoginOverlay();
    return;
  }
  if (!checkDomain(user.email)) {
    await signOut(auth);
    document.documentElement.style.visibility = 'visible';
    showLoginOverlay();
    const err = document.getElementById('auth-error');
    if (err) err.textContent = '許可されていないメアドです: ' + user.email;
    return;
  }
  hideLoginOverlay();
  document.documentElement.style.visibility = 'visible';
  window.dispatchEvent(new Event('summit-auth-ready'));
});
