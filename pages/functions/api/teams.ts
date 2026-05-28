/**
 * GET  /api/teams           - 全チーム取得
 * POST /api/teams           - 新規チーム追加（admin only）
 */
import { Env, jsonResponse, getUser, nowIso, logAudit } from './_lib';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const res = await env.DB.prepare(
    'SELECT id, name, color, sort_order as sortOrder, active, created_at as createdAt, updated_at as updatedAt FROM teams ORDER BY sort_order'
  ).all();
  const teams = (res.results || []).map((r: any) => ({ ...r, active: r.active === 1 }));
  return jsonResponse({ teams });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const user = getUser(context);
  if (user.role !== 'admin') return jsonResponse({ error: 'admin role required' }, 403);

  const body = await request.json<{ id: string; name: string; color: string; sortOrder?: number }>();
  if (!body.id || !body.name) return jsonResponse({ error: 'id and name are required' }, 400);

  const now = nowIso();
  await env.DB.prepare(
    'INSERT INTO teams (id, name, color, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).bind(body.id, body.name, body.color || '#cccccc', body.sortOrder ?? Date.now(), now, now).run();

  await logAudit(env, user.email, 'team.create', body.id, body);
  return jsonResponse({ ok: true, id: body.id });
};
