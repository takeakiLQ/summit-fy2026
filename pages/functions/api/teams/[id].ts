/**
 * PUT /api/teams/:id    - チーム更新（admin only）
 *
 * body: { name?, color?, sortOrder?, active? }
 */
import { Env, jsonResponse, getUser, nowIso, logAudit } from '../_lib';

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const user = getUser(context);
  if (user.role !== 'admin') return jsonResponse({ error: 'admin role required' }, 403);

  const id = params.id as string;
  if (!id) return jsonResponse({ error: 'id required' }, 400);

  const body = await request.json<{ name?: string; color?: string; sortOrder?: number; active?: boolean }>();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); args.push(body.name); }
  if (body.color !== undefined) { sets.push('color = ?'); args.push(body.color); }
  if (body.sortOrder !== undefined) { sets.push('sort_order = ?'); args.push(body.sortOrder); }
  if (body.active !== undefined) { sets.push('active = ?'); args.push(body.active ? 1 : 0); }
  if (sets.length === 0) return jsonResponse({ error: 'no fields' }, 400);
  sets.push('updated_at = ?'); args.push(nowIso());
  args.push(id);

  const result = await env.DB.prepare(
    `UPDATE teams SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...args).run();

  await logAudit(env, user.email, 'team.update', id, body);
  return jsonResponse({ ok: true, changes: result.meta.changes });
};
