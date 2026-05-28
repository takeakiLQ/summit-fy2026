/**
 * Pages Functions 共通ヘルパー
 */

export interface Env {
  DB: D1Database;
  SYNC_API_KEY: string;
  ALLOWED_EMAIL_DOMAINS: string;
}

export interface UserCtx {
  email: string;
  role: string; // 'admin' | 'member' | 'inactive' | 'system'
  name?: string;
  team?: string;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function getUser(context: EventContext<Env, string, Record<string, unknown>>): UserCtx {
  return (context.data.user as UserCtx) || { email: 'unknown', role: 'unknown' };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function yearMonthToFY(ym: string | null | undefined): string | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return 'FY' + (m >= 4 ? y : y - 1);
}

export async function logAudit(env: Env, userEmail: string, action: string, target: string, detail?: unknown): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (user_email, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(userEmail, action, target, JSON.stringify(detail || null), nowIso()).run();
  } catch (e) {
    console.error('audit log failed:', e);
  }
}
