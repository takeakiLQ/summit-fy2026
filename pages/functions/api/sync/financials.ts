/**
 * POST /api/sync/financials
 *
 * CSV取込やGitHub Actions が呼ぶ。月別実績をUPSERTし、summary再計算。
 *
 * Body:
 *   {
 *     rows: FinancialRow[]   // csv-importの matchedRows
 *     replaceMonths?: string[]  // 指定された月の既存データを削除してから入れ替え（UPSERT）
 *   }
 */
import { Env, jsonResponse } from '../_lib';
import { recomputeSummary } from './_recompute';

interface FinancialRow {
  yearMonth: string;
  dealId: string;
  manualNo?: string;
  ownerName?: string;
  teamId?: string;
  revenue: number;
  grossProfit: number;
  workdays?: number;
}

function yearMonthToFY(ym: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return 'FY' + (m >= 4 ? y : y - 1);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  let body: { rows: FinancialRow[]; replaceMonths?: string[]; uploadedBy?: string; sourceFile?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }
  if (!body.rows || !Array.isArray(body.rows)) {
    return jsonResponse({ error: 'rows array required' }, 400);
  }

  const now = new Date().toISOString();

  // UPSERT: 指定月の既存データを削除
  const monthsToReplace = body.replaceMonths || Array.from(new Set(body.rows.map(r => r.yearMonth).filter(Boolean)));
  for (const ym of monthsToReplace) {
    await env.DB.prepare('DELETE FROM monthly_revenue WHERE year_month = ?').bind(ym).run();
  }

  // dealId → kind マップ
  const dealKindRes = await env.DB.prepare('SELECT id, kind FROM deals').all<{ id: string; kind: string }>();
  const dealIdToKind = new Map<string, string>();
  for (const d of dealKindRes.results || []) dealIdToKind.set(d.id, d.kind || 'Qhai');

  // 新データ書込
  const insertSql = `
    INSERT INTO monthly_revenue (
      id, year_month, fiscal_year, deal_id, manual_no,
      owner_name, team_id, revenue, gross_profit, workdays,
      uploaded_at, uploaded_by, source_file, kind
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      year_month=excluded.year_month, fiscal_year=excluded.fiscal_year,
      deal_id=excluded.deal_id, manual_no=excluded.manual_no,
      owner_name=excluded.owner_name, team_id=excluded.team_id,
      revenue=excluded.revenue, gross_profit=excluded.gross_profit, workdays=excluded.workdays,
      uploaded_at=excluded.uploaded_at, uploaded_by=excluded.uploaded_by, source_file=excluded.source_file,
      kind=excluded.kind
  `;
  const stmts: D1PreparedStatement[] = [];
  for (const r of body.rows) {
    const id = r.yearMonth + '_' + r.dealId;
    stmts.push(env.DB.prepare(insertSql).bind(
      id, r.yearMonth, yearMonthToFY(r.yearMonth), r.dealId, r.manualNo ?? null,
      r.ownerName ?? null, r.teamId ?? null,
      r.revenue ?? 0, r.grossProfit ?? 0, r.workdays ?? 0,
      now, body.uploadedBy || 'system', body.sourceFile || null,
      dealIdToKind.get(r.dealId) || 'Qhai'
    ));
  }
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  // meta更新
  await env.DB.prepare(
    `INSERT INTO meta (key, value, updated_at) VALUES ('sync_status', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).bind(JSON.stringify({
    lastCsvImport: now,
    lastCsvImportMonths: monthsToReplace,
    lastCsvImportRows: body.rows.length,
    lastCsvImportBy: body.uploadedBy || 'system',
  }), now).run();

  // summary 再計算
  await recomputeSummary(env);

  return jsonResponse({ ok: true, upserted: body.rows.length, replacedMonths: monthsToReplace });
};
