/**
 * PUT /api/members/:email   - メンバー更新（admin only）
 *
 * body: { name?, team?, role?, active? }
 */
import { Env, jsonResponse, getUser, nowIso, logAudit } from '../_lib';

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const user = getUser(context);
  if (user.role !== 'admin') return jsonResponse({ error: 'admin role required' }, 403);

  const email = decodeURIComponent(params.email as string).toLowerCase();
  if (!email) return jsonResponse({ error: 'email required' }, 400);

  const body = await request.json<{ name?: string; team?: string; role?: string; active?: boolean }>();
  const sets: string[] = [];
  const args: unknown[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); args.push(body.name); }
  if (body.team !== undefined) { sets.push('team = ?'); args.push(body.team); }
  if (body.role !== undefined) { sets.push('role = ?'); args.push(body.role); }
  if (body.active !== undefined) { sets.push('active = ?'); args.push(body.active ? 1 : 0); }
  if (sets.length === 0) return jsonResponse({ error: 'no fields' }, 400);
  sets.push('updated_at = ?'); args.push(nowIso());
  args.push(email);

  const result = await env.DB.prepare(
    `UPDATE members SET ${sets.join(', ')} WHERE email = ?`
  ).bind(...args).run();

  await logAudit(env, user.email, 'member.update', email, body);
  return jsonResponse({ ok: true, changes: result.meta.changes });
};
