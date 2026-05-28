/**
 * Cloudflare Pages Functions - 認証ミドルウェア
 *
 * 認証方式: Firebase Auth ID Token を Authorization: Bearer ヘッダで受け取り、
 * Firebase Identity Toolkit API で検証してメアドを取得する。
 *
 * 動作:
 * - /api/sync/* は SYNC_API_KEY 認証（GitHub Actions等）
 * - それ以外の /api/* は Firebase ID Token を検証
 * - 静的ファイル（/, /*.js, /*.css 等）は素通し（クライアント側でAuth）
 */

interface Env {
  DB: D1Database;
  SYNC_API_KEY: string;
  ALLOWED_EMAIL_DOMAINS: string;
  FIREBASE_PROJECT_ID: string;       // 'summit-fy2026'
  FIREBASE_API_KEY: string;          // FirebaseのWebAPIキー
}

interface FirebaseUser {
  email: string;
  emailVerified: boolean;
  uid: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 静的アセットは素通し（クライアント側でAuth）
  if (!pathname.startsWith('/api/')) {
    return next();
  }

  // /api/sync/* は SYNC_API_KEY 認証
  if (pathname.startsWith('/api/sync/')) {
    const key = request.headers.get('x-sync-api-key');
    if (!key || key !== env.SYNC_API_KEY) {
      return jsonResponse({ error: 'Unauthorized: invalid sync API key' }, 401);
    }
    context.data.user = { email: 'system@sync', role: 'system' };
    return next();
  }

  // Firebase ID Token を検証
  const auth = request.headers.get('Authorization');
  let email: string | null = null;

  if (auth && auth.startsWith('Bearer ')) {
    const idToken = auth.slice(7);
    try {
      const fbUser = await verifyFirebaseIdToken(env, idToken);
      email = fbUser.email;
    } catch (e) {
      return jsonResponse({ error: 'Invalid Firebase ID token', detail: String(e) }, 401);
    }
  } else {
    // 開発用フォールバック
    const devEmail = request.headers.get('x-dev-email');
    if (devEmail) {
      email = devEmail;
    } else {
      return jsonResponse({ error: 'Unauthorized: missing Authorization header' }, 401);
    }
  }

  // ドメイン制限
  const domain = email.split('@')[1] || '';
  const allowedDomains = (env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(d => d.trim()).filter(Boolean);
  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    return jsonResponse({ error: 'Forbidden: domain not allowed', domain }, 403);
  }

  // D1からrole取得
  const member = await env.DB.prepare(
    'SELECT role, name, team, active FROM members WHERE email = ?'
  ).bind(email).first<{ role: string; name: string; team: string; active: number }>();

  const user = {
    email,
    role: member?.active === 0 ? 'inactive' : (member?.role || 'member'),
    name: member?.name,
    team: member?.team,
  };
  context.data.user = user;

  // /api/admin/* は admin only
  if (pathname.startsWith('/api/admin/') && user.role !== 'admin') {
    return jsonResponse({ error: 'Forbidden: admin role required' }, 403);
  }

  return next();
};

/**
 * Firebase Identity Toolkit API を叩いてIDトークン検証
 * https://firebase.google.com/docs/reference/rest/auth#section-verify-id-token
 */
async function verifyFirebaseIdToken(env: Env, idToken: string): Promise<FirebaseUser> {
  if (!env.FIREBASE_API_KEY) throw new Error('FIREBASE_API_KEY not configured');
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firebase verify failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json<{ users?: Array<{ email: string; emailVerified: boolean; localId: string }> }>();
  if (!data.users || data.users.length === 0) throw new Error('No user found for token');
  const u = data.users[0]!;
  return { email: u.email, emailVerified: u.emailVerified, uid: u.localId };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
