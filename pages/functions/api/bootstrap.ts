/**
 * GET /api/bootstrap
 *
 * ダッシュボード初回ロードに必要なデータを1回のリクエストで全部返す。
 * - summary（事前集計）
 * - teams（active=true）+ teamsAll（全件、設定画面用）
 * - members（active=true）+ membersAll（全件、設定画面用）
 * - settings/kpi
 * - meta（sync_status）
 * - 自分のロール
 *
 * D1への問い合わせ回数: 7クエリ程度。読取は数十行のみ。
 */
import { Env, UserCtx, jsonResponse, getUser } from './_lib';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const user = getUser(context);

  try {
    // 並列実行
    const [summaryRow, settingsRow, metaRow, teamsRes, membersRes] = await Promise.all([
      env.DB.prepare("SELECT value, computed_at FROM summary WHERE key = 'aggregate'").first<{ value: string; computed_at: string }>(),
      env.DB.prepare("SELECT value FROM settings WHERE key = 'kpi'").first<{ value: string }>(),
      env.DB.prepare("SELECT value FROM meta WHERE key = 'sync_status'").first<{ value: string }>(),
      env.DB.prepare('SELECT id, name, color, sort_order as sortOrder, active, created_at as createdAt, updated_at as updatedAt FROM teams ORDER BY sort_order').all(),
      env.DB.prepare('SELECT email, name, team, role, active, created_at as createdAt, updated_at as updatedAt FROM members ORDER BY team, name').all(),
    ]);

    // summary は JSON 文字列で保存されているのでパース
    const summaryData = summaryRow ? JSON.parse(summaryRow.value) : null;
    const settingsKpi = settingsRow ? JSON.parse(settingsRow.value) : {};
    const metaData = metaRow ? JSON.parse(metaRow.value) : {};

    // active判定
    const teamsAll = (teamsRes.results || []).map((r: any) => ({
      id: r.id, name: r.name, color: r.color, sortOrder: r.sortOrder,
      active: r.active === 1, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
    const membersAll = (membersRes.results || []).map((r: any) => ({
      email: r.email, name: r.name, team: r.team, role: r.role,
      active: r.active === 1, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));

    return jsonResponse({
      user: {
        email: user.email,
        role: user.role,
        name: user.name || null,
        team: user.team || null,
      },
      summary: summaryData,
      summaryComputedAt: summaryRow?.computed_at || null,
      settings: { kpi: settingsKpi },
      meta: metaData,
      teamsAll,
      membersAll,
    });
  } catch (e) {
    console.error('bootstrap error:', e);
    return jsonResponse({ error: 'Bootstrap failed', detail: String(e) }, 500);
  }
};
