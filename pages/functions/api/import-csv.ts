/**
 * POST /api/import-csv  - ブラウザのCSV取込からの呼び出し
 *
 * Body: { rows: [{yearMonth, manualNo, revenue, grossProfit, workdays}], months: [yearMonth], fileName }
 *
 * Workers側で manualNo → deal の突合を行い、UPSERT。最後に summary 再計算。
 */
import { Env, jsonResponse, getUser, nowIso, logAudit } from './_lib';
import { recomputeSummary } from './sync/_recompute';

interface CsvRow {
  yearMonth: string;
  manualNo: string;
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
  const user = getUser(context);
  if (user.role !== 'admin') return jsonResponse({ error: 'admin role required' }, 403);

  let body: { rows: CsvRow[]; months: string[]; fileName?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }
  if (!body.rows || !Array.isArray(body.rows)) {
    return jsonResponse({ error: 'rows required' }, 400);
  }

  const now = nowIso();
  const months = body.months || Array.from(new Set(body.rows.map(r => r.yearMonth)));

  // 案件マスタを取得（manualNo→deal）
  const dealsRes = await env.DB.prepare('SELECT id, manual_no, owner_name, team_id FROM deals').all<{ id: string; manual_no: string; owner_name: string; team_id: string }>();
  const manualToDeal = new Map<string, { id: string; ownerName: string; teamId: string }>();
  for (const d of dealsRes.results || []) {
    if (d.manual_no) {
      manualToDeal.set(String(d.manual_no).trim(), { id: d.id, ownerName: d.owner_name, teamId: d.team_id });
    }
  }

  // 既存月のデータ削除
  let totalDeleted = 0;
  for (const ym of months) {
    const r = await env.DB.prepare('DELETE FROM monthly_revenue WHERE year_month = ?').bind(ym).run();
    totalDeleted += r.meta.changes || 0;
  }

  // 突合と書込
  const insertSql = `
    INSERT INTO monthly_revenue (
      id, year_month, fiscal_year, deal_id, manual_no,
      owner_name, team_id, revenue, gross_profit, workdays,
      uploaded_at, uploaded_by, source_file
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `;
  const stmts: D1PreparedStatement[] = [];
  let matched = 0, unmatched = 0;
  for (const r of body.rows) {
    const deal = manualToDeal.get(String(r.manualNo).trim());
    if (!deal) { unmatched++; continue; }
    matched++;
    const id = r.yearMonth + '_' + deal.id;
    stmts.push(env.DB.prepare(insertSql).bind(
      id, r.yearMonth, yearMonthToFY(r.yearMonth), deal.id, r.manualNo,
      deal.ownerName, deal.teamId,
      r.revenue || 0, r.grossProfit || 0, r.workdays || 0,
      now, user.email, body.fileName || null
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
    lastCsvImportMonths: months,
    lastCsvImportRows: matched,
    lastCsvImportBy: user.email,
  }), now).run();

  // summary 再計算
  await recomputeSummary(env);

  // 監査ログ
  await logAudit(env, user.email, 'csv_import', 'monthly_revenue', { months, matched, unmatched, fileName: body.fileName });

  return jsonResponse({ ok: true, deleted: totalDeleted, upserted: matched, matched, unmatched });
};
