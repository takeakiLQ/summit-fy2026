/**
 * POST /api/sync/deals
 *
 * GitHub Actions が呼び出す。Salesforceから取得した案件をD1に UPSERT し、
 * 差分削除（SF側でなくなった案件をD1から削除）して、最後にsummary再計算する。
 *
 * Body:
 *   {
 *     deals: NormalizedDeal[],  // sf-extract + kpi-compute の出力
 *   }
 *
 * Headers:
 *   x-sync-api-key: <SYNC_API_KEY>
 */
import { Env, jsonResponse } from '../_lib';
import { recomputeSummary } from './_recompute';

interface DealInput {
  id: string;
  name?: string;
  manualNo?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerNameRaw?: string;
  ownerEmailRaw?: string;
  matchedBy?: string;
  teamId?: string;
  msKbnRaw?: string;
  msKbn?: string;
  monthlyRevenue?: number;
  contractPrice?: number;
  monthlyWorkdays?: number;
  dailyHours?: number;
  status?: string;
  classification?: string;
  operationStartDate?: string;
  plannedStartDate?: string;
  registeredAt?: string;
  lastModifiedAt?: string;
  hourlyRate?: number;
  hourlyCoef?: number;
  hourlyCoefLabel?: string;
  basePoint?: number;
  point?: number;
  hasIssue?: boolean;
  issues?: string[];
  yearMonth?: string;
}

function yearMonthToFY(ym?: string): string | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return 'FY' + (m >= 4 ? y : y - 1);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  let body: { deals: DealInput[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }
  if (!body.deals || !Array.isArray(body.deals)) {
    return jsonResponse({ error: 'deals array required' }, 400);
  }

  // 0件は安全ガード（SF認証失敗等で全削除を防ぐ）
  if (body.deals.length === 0) {
    return jsonResponse({ error: '0件のため処理スキップ（安全ガード）', skipped: true }, 200);
  }

  const now = new Date().toISOString();

  // バッチアップサート (D1の bind は SQLite なので INSERT ON CONFLICT が使える)
  const insertSql = `
    INSERT INTO deals (
      id, name, manual_no, owner_name, owner_email, owner_name_raw, owner_email_raw,
      matched_by, team_id, ms_kbn_raw, ms_kbn,
      monthly_revenue, contract_price, monthly_workdays, daily_hours,
      status, classification, operation_start_date, planned_start_date,
      registered_at, last_modified_at,
      hourly_rate, hourly_coef, hourly_coef_label, base_point, point,
      has_issue, issues, year_month, fiscal_year, synced_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, manual_no=excluded.manual_no,
      owner_name=excluded.owner_name, owner_email=excluded.owner_email,
      owner_name_raw=excluded.owner_name_raw, owner_email_raw=excluded.owner_email_raw,
      matched_by=excluded.matched_by, team_id=excluded.team_id,
      ms_kbn_raw=excluded.ms_kbn_raw, ms_kbn=excluded.ms_kbn,
      monthly_revenue=excluded.monthly_revenue, contract_price=excluded.contract_price,
      monthly_workdays=excluded.monthly_workdays, daily_hours=excluded.daily_hours,
      status=excluded.status, classification=excluded.classification,
      operation_start_date=excluded.operation_start_date, planned_start_date=excluded.planned_start_date,
      registered_at=excluded.registered_at, last_modified_at=excluded.last_modified_at,
      hourly_rate=excluded.hourly_rate, hourly_coef=excluded.hourly_coef,
      hourly_coef_label=excluded.hourly_coef_label, base_point=excluded.base_point, point=excluded.point,
      has_issue=excluded.has_issue, issues=excluded.issues,
      year_month=excluded.year_month, fiscal_year=excluded.fiscal_year,
      synced_at=excluded.synced_at
  `;

  const stmts: D1PreparedStatement[] = [];
  for (const d of body.deals) {
    stmts.push(env.DB.prepare(insertSql).bind(
      d.id, d.name ?? null, d.manualNo ?? null,
      d.ownerName ?? null, d.ownerEmail ?? null,
      d.ownerNameRaw ?? null, d.ownerEmailRaw ?? null,
      d.matchedBy ?? null, d.teamId ?? null,
      d.msKbnRaw ?? null, d.msKbn ?? null,
      d.monthlyRevenue ?? null, d.contractPrice ?? null,
      d.monthlyWorkdays ?? null, d.dailyHours ?? null,
      d.status ?? null, d.classification ?? null,
      d.operationStartDate ?? null, d.plannedStartDate ?? null,
      d.registeredAt ?? null, d.lastModifiedAt ?? null,
      d.hourlyRate ?? null, d.hourlyCoef ?? null,
      d.hourlyCoefLabel ?? null, d.basePoint ?? null, d.point ?? 0,
      d.hasIssue ? 1 : 0, d.issues ? JSON.stringify(d.issues) : null,
      d.yearMonth ?? null, yearMonthToFY(d.yearMonth),
      now
    ));
  }

  // 50件ずつバッチ実行（D1のbatchサイズ上限を考慮）
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  // 差分削除: SF取得結果に含まれないIDを削除
  const sfIds = new Set(body.deals.map(d => d.id));
  const existing = await env.DB.prepare('SELECT id FROM deals').all<{ id: string }>();
  const orphanIds = (existing.results || []).map(r => r.id).filter(id => !sfIds.has(id));
  let orphansDeleted = 0;
  if (orphanIds.length > 0) {
    // 50件ずつ削除
    for (let i = 0; i < orphanIds.length; i += 50) {
      const slice = orphanIds.slice(i, i + 50);
      const placeholders = slice.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM deals WHERE id IN (${placeholders})`).bind(...slice).run();
    }
    orphansDeleted = orphanIds.length;
  }

  // meta/sync_status 更新
  await env.DB.prepare(
    `INSERT INTO meta (key, value, updated_at) VALUES ('sync_status', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).bind(JSON.stringify({
    lastSfSync: now,
    lastSfSyncDeals: body.deals.length,
    lastSfSyncOrphansDeleted: orphansDeleted,
    lastSfSyncBy: 'github-actions',
  }), now).run();

  // summary 再計算
  const summary = await recomputeSummary(env);

  return jsonResponse({
    ok: true,
    upserted: body.deals.length,
    orphansDeleted,
    summary: { sourceDeals: summary.sourceDeals, activeTeams: summary.activeTeamCount, activeMembers: summary.activeMemberCount },
  });
};
