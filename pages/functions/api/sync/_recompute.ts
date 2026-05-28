/**
 * Summary 再計算ロジック
 * 案件と実績データから集計サマリーを再計算し、summaryテーブルに保存
 */
import { Env, nowIso } from '../_lib';
import { aggregate, aggregateByMonth, aggregateByFiscalYear, computeFinancials, type Deal, type FinancialRow } from '../_aggregate';

export async function recomputeSummary(env: Env) {
  // activeメンバー・チーム取得
  const teamsRes = await env.DB.prepare('SELECT id, active FROM teams').all<{ id: string; active: number }>();
  const activeTeamIds = new Set<string>();
  for (const t of teamsRes.results || []) if (t.active === 1) activeTeamIds.add(t.id);

  const membersRes = await env.DB.prepare('SELECT email, name, team, active FROM members').all<{ email: string; name: string; team: string; active: number }>();
  const activeMemberEmails = new Set<string>();
  const activeMemberNames = new Set<string>();
  for (const m of membersRes.results || []) {
    if (m.active !== 1) continue;
    if (m.email) activeMemberEmails.add(m.email);
    if (m.name) activeMemberNames.add(m.name);
  }

  // 全dealsを取得し、activeフィルタ
  const dealsRes = await env.DB.prepare(
    'SELECT id, owner_name, owner_email, team_id, year_month, point, ms_kbn, hourly_coef, has_issue, monthly_revenue FROM deals'
  ).all<any>();
  const totalDeals = (dealsRes.results || []).length;
  const filtered: Deal[] = (dealsRes.results || [])
    .filter((d: any) => {
      if (d.team_id && !activeTeamIds.has(d.team_id)) return false;
      if (d.owner_email) return activeMemberEmails.has(d.owner_email);
      if (d.owner_name) return activeMemberNames.has(d.owner_name);
      return false;
    })
    .map((d: any) => ({
      id: d.id,
      ownerName: d.owner_name,
      ownerEmail: d.owner_email,
      teamId: d.team_id,
      yearMonth: d.year_month,
      point: d.point || 0,
      msKbn: d.ms_kbn,
      hourlyCoef: d.hourly_coef,
      hasIssue: d.has_issue === 1,
      monthlyRevenue: d.monthly_revenue,
    }));

  // 実績データ取得
  const finRes = await env.DB.prepare('SELECT year_month, deal_id, owner_name, team_id, revenue, gross_profit FROM monthly_revenue').all<any>();
  const rows: FinancialRow[] = (finRes.results || []).map((r: any) => ({
    yearMonth: r.year_month,
    dealId: r.deal_id,
    ownerName: r.owner_name,
    teamId: r.team_id,
    revenue: r.revenue || 0,
    grossProfit: r.gross_profit || 0,
  }));

  // 集計
  const overall = aggregate(filtered);
  const byPeriod = aggregateByMonth(filtered);
  const byFy = aggregateByFiscalYear(filtered);
  const fin = computeFinancials(filtered, rows);

  const summary = {
    aggregate: overall,
    aggregateByPeriod: byPeriod,
    aggregateByFiscalYear: byFy,
    financials: fin.financials,
    financialsByPeriod: fin.financialsByPeriod,
    financialsByFiscalYear: fin.financialsByFiscalYear,
    memberFinancials: fin.memberFinancials,
    activeMemberCount: activeMemberEmails.size,
    activeTeamCount: activeTeamIds.size,
    sourceDeals: filtered.length,
    totalDeals,
    sourceFinancialRows: fin.validRowCount,
  };

  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO summary (key, value, computed_at) VALUES ('aggregate', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, computed_at=excluded.computed_at`
  ).bind(JSON.stringify(summary), now).run();

  return summary;
}
