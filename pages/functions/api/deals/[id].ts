/**
 * GET /api/deals/:id  - 案件1件取得（案件詳細モーダル用）
 */
import { Env, jsonResponse } from '../_lib';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;
  if (!id) return jsonResponse({ error: 'id required' }, 400);
  const r = await env.DB.prepare('SELECT * FROM deals WHERE id = ?').bind(id).first<any>();
  if (!r) return jsonResponse({ error: 'not found' }, 404);
  return jsonResponse({
    deal: {
      id: r.id, name: r.name, manualNo: r.manual_no,
      ownerName: r.owner_name, ownerEmail: r.owner_email,
      ownerNameRaw: r.owner_name_raw, ownerEmailRaw: r.owner_email_raw,
      matchedBy: r.matched_by, teamId: r.team_id,
      msKbnRaw: r.ms_kbn_raw, msKbn: r.ms_kbn,
      monthlyRevenue: r.monthly_revenue, contractPrice: r.contract_price,
      monthlyWorkdays: r.monthly_workdays, dailyHours: r.daily_hours,
      status: r.status, classification: r.classification,
      operationStartDate: r.operation_start_date, plannedStartDate: r.planned_start_date,
      registeredAt: r.registered_at, lastModifiedAt: r.last_modified_at,
      hourlyRate: r.hourly_rate, hourlyCoef: r.hourly_coef,
      hourlyCoefLabel: r.hourly_coef_label, basePoint: r.base_point,
      point: r.point, hasIssue: r.has_issue === 1,
      issues: r.issues ? JSON.parse(r.issues) : [],
      yearMonth: r.year_month, fiscalYear: r.fiscal_year,
    }
  });
};
