/**
 * GET  /api/members         - 全メンバー取得
 * POST /api/members         - 新規メンバー追加（admin only）
 */
import { Env, jsonResponse, getUser, nowIso, logAudit } from './_lib';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const res = await env.DB.prepare(
    'SELECT email, name, team, role, active, created_at as createdAt, updated_at as updatedAt FROM members ORDER BY team, name'
  ).all();
  const members = (res.results || []).map((r: any) => ({ ...r, active: r.active === 1 }));
  return jsonResponse({ members });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const user = getUser(context);
  if (user.role !== 'admin') return jsonResponse({ error: 'admin role required' }, 403);

  const body = await request.json<{ email: string; name: string; team: string; role?: string }>();
  if (!body.email || !body.name || !body.team) {
    return jsonResponse({ error: 'email, name, team are required' }, 400);
  }

  const now = nowIso();
  await env.DB.prepare(
    'INSERT INTO members (email, name, team, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).bind(body.email.toLowerCase(), body.name, body.team, body.role || 'member', now, now).run();

  await logAudit(env, user.email, 'member.create', body.email, body);
  return jsonResponse({ ok: true, email: body.email });
};
