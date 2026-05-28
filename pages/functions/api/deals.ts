/**
 * GET /api/deals?owner=email@domain.com  - 特定メンバーの案件取得（個人詳細用）
 * GET /api/deals?ownerName=名前         - 名前で検索
 *
 * lazy load用: 1人あたり数件〜数十件の読取
 */
import { Env, jsonResponse } from './_lib';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);
  const ownerEmail = url.searchParams.get('owner');
  const ownerName = url.searchParams.get('ownerName');

  if (!ownerEmail && !ownerName) {
    return jsonResponse({ error: 'owner or ownerName parameter required' }, 400);
  }

  const query = ownerEmail
    ? 'SELECT * FROM deals WHERE owner_email = ? ORDER BY operation_start_date DESC'
    : 'SELECT * FROM deals WHERE owner_name = ? ORDER BY operation_start_date DESC';
  const arg = ownerEmail || ownerName!;

  const res = await env.DB.prepare(query).bind(arg).all();
  const deals = (res.results || []).map(rowToDeal);
  return jsonResponse({ deals });
};

function rowToDeal(r: any) {
  return {
    id: r.id,
    name: r.name,
    manualNo: r.manual_no,
    ownerName: r.owner_name,
    ownerEmail: r.owner_email,
    ownerNameRaw: r.owner_name_raw,
    ownerEmailRaw: r.owner_email_raw,
    matchedBy: r.matched_by,
    teamId: r.team_id,
    msKbnRaw: r.ms_kbn_raw,
    msKbn: r.ms_kbn,
    monthlyRevenue: r.monthly_revenue,
    contractPrice: r.contract_price,
    monthlyWorkdays: r.monthly_workdays,
    dailyHours: r.daily_hours,
    status: r.status,
    classification: r.classification,
    operationStartDate: r.operation_start_date,
    plannedStartDate: r.planned_start_date,
    registeredAt: r.registered_at,
    lastModifiedAt: r.last_modified_at,
    hourlyRate: r.hourly_rate,
    hourlyCoef: r.hourly_coef,
    hourlyCoefLabel: r.hourly_coef_label,
    basePoint: r.base_point,
    point: r.point,
    hasIssue: r.has_issue === 1,
    issues: r.issues ? JSON.parse(r.issues) : [],
    yearMonth: r.year_month,
    fiscalYear: r.fiscal_year,
    kind: r.kind || 'Qhai',
  };
}
