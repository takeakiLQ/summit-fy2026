/**
 * POST /api/sync/recompute  - サマリー再計算（管理者の手動トリガー or 設定変更後）
 *
 * Body: 不要
 */
import { Env, jsonResponse } from '../_lib';
import { recomputeSummary } from './_recompute';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const summary = await recomputeSummary(env);
  return jsonResponse({
    ok: true,
    activeMemberCount: summary.activeMemberCount,
    activeTeamCount: summary.activeTeamCount,
    sourceDeals: summary.sourceDeals,
    totalDeals: summary.totalDeals,
    sourceFinancialRows: summary.sourceFinancialRows,
  });
};
