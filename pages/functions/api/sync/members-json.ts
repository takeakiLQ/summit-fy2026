/**
 * GET /api/sync/members-json
 *
 * GitHub Actions が sf-extract 実行前に呼んで members.json を取得する。
 * 「SF SOQL対象として active 関係なく全員」「ただし非アクティブチームのメンバーは除外」の方針
 *
 * Response: { teams: [{id, name, color}], members: [{name, email, team}] }
 */
import { Env, jsonResponse } from '../_lib';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const teamsRes = await env.DB.prepare(
    'SELECT id, name, color, sort_order FROM teams WHERE active = 1 ORDER BY sort_order'
  ).all<{ id: string; name: string; color: string; sort_order: number }>();

  const activeTeamIds = new Set((teamsRes.results || []).map(t => t.id));
  const teams = (teamsRes.results || []).map(t => ({ id: t.id, name: t.name, color: t.color }));

  // メンバーは active=true/false 関係なく取得（SF取得は全員分維持）
  // 所属チームが非アクティブ（本部など）の場合は除外。admin ロールでも T1〜T4 所属なら含める。
  const membersRes = await env.DB.prepare('SELECT email, name, team FROM members').all<{ email: string; name: string; team: string }>();
  const members = (membersRes.results || [])
    .filter(m => activeTeamIds.has(m.team))
    .map(m => ({ name: m.name, email: m.email, team: m.team }));

  return jsonResponse({ teams, members });
};
