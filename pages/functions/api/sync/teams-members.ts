/**
 * POST /api/sync/teams-members
 *
 * GitHub Actions が呼ぶ。members.jsonをD1に同期し、新規発生時は active:true, role:'member' を初期付与。
 * 既存ドキュメントの active/role はそのまま維持（Web UI管理項目を保護）。
 *
 * Body:
 *   {
 *     teams: { id, name, color, sortOrder? }[],
 *     members: { email, name, team }[]
 *   }
 */
import { Env, jsonResponse, nowIso } from '../_lib';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  let body: { teams: Array<{ id: string; name: string; color?: string; sortOrder?: number }>; members: Array<{ email: string; name: string; team: string }> };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }
  if (!body.teams || !body.members) return jsonResponse({ error: 'teams and members required' }, 400);

  const now = nowIso();

  // teams: name/color/sortOrder を更新。active は変更しない（既存維持）
  for (let i = 0; i < body.teams.length; i++) {
    const t = body.teams[i];
    if (!t) continue;
    await env.DB.prepare(
      `INSERT INTO teams (id, name, color, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, color=excluded.color, sort_order=excluded.sort_order,
         updated_at=excluded.updated_at`
    ).bind(t.id, t.name, t.color || '#cccccc', t.sortOrder ?? i + 1, now, now).run();
  }

  // members: email/name/team を更新。role/active は変更しない（既存維持）
  for (const m of body.members) {
    await env.DB.prepare(
      `INSERT INTO members (email, name, team, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'member', 1, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         name=excluded.name, team=excluded.team,
         updated_at=excluded.updated_at`
    ).bind(m.email.toLowerCase(), m.name, m.team, now, now).run();
  }

  return jsonResponse({ ok: true, teams: body.teams.length, members: body.members.length });
};
