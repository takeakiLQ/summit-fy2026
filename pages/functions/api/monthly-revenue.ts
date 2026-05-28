/**
 * GET /api/monthly-revenue?deal=<dealId>     - 特定案件の実績取得
 * GET /api/monthly-revenue?owner=<ownerName> - 特定メンバーの実績取得
 */
import { Env, jsonResponse } from './_lib';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);
  const dealId = url.searchParams.get('deal');
  const owner = url.searchParams.get('owner');

  if (!dealId && !owner) return jsonResponse({ error: 'deal or owner required' }, 400);

  const query = dealId
    ? 'SELECT * FROM monthly_revenue WHERE deal_id = ? ORDER BY year_month'
    : 'SELECT * FROM monthly_revenue WHERE owner_name = ? ORDER BY year_month';
  const arg = dealId || owner!;

  const res = await env.DB.prepare(query).bind(arg).all();
  const rows = (res.results || []).map((r: any) => ({
    id: r.id,
    yearMonth: r.year_month,
    fiscalYear: r.fiscal_year,
    dealId: r.deal_id,
    manualNo: r.manual_no,
    ownerName: r.owner_name,
    teamId: r.team_id,
    revenue: r.revenue,
    grossProfit: r.gross_profit,
    workdays: r.workdays,
    uploadedAt: r.uploaded_at,
  }));
  return jsonResponse({ rows });
};
