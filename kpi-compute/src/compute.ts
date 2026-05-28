/**
 * KPI 計算ロジック
 *
 * 1案件ごとに:
 *   時間当たり単価 = monthlyRevenue / monthlyWorkdays / dailyHours
 *   時間当たり係数 = 閾値テーブルから決定（4000円以上×2.0, 3000円以上×1.5, それ未満×1.0）
 *   獲得ポイント   = メイン/サブpt × 時間当たり係数
 *
 * データ異常時は 'issues' に記録し、hasIssue=true / point=0 として扱う。
 */
import type { SfExtractDeal, KpiSettings, DealWithPoint } from './types.js';

function determineCoef(hourlyRate: number, thresholds: KpiSettings['hourlyCoefThresholds']): { coef: number; label: string | null } {
  // thresholds は降順ソート済み前提（config.tsで保証）
  for (const t of thresholds) {
    if (hourlyRate >= t.min) return { coef: t.coef, label: t.label ?? null };
  }
  return { coef: 1.0, label: null };
}

function yearMonthOf(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  // YYYY-MM-DD... の先頭7文字をYYYY-MMとして使う
  if (dateStr.length < 7) return null;
  const ym = dateStr.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  return ym;
}

export function computeDealPoint(deal: SfExtractDeal, settings: KpiSettings): DealWithPoint {
  const issues: string[] = [];

  // データ欠損チェック
  if (settings.issueRules.missingMonthlyRevenue && (deal.monthlyRevenue == null || deal.monthlyRevenue <= 0)) {
    issues.push('monthlyRevenue が未入力または0');
  }
  if (settings.issueRules.missingMonthlyWorkdays && (deal.monthlyWorkdays == null || deal.monthlyWorkdays <= 0)) {
    issues.push('monthlyWorkdays が未入力または0');
  }
  if (settings.issueRules.missingDailyHours && (deal.dailyHours == null || deal.dailyHours <= 0)) {
    issues.push('dailyHours が未入力または0');
  }

  // 時間当たり単価の計算（0除算回避）
  let hourlyRate: number | null = null;
  if (
    deal.monthlyRevenue != null && deal.monthlyRevenue > 0 &&
    deal.monthlyWorkdays != null && deal.monthlyWorkdays > 0 &&
    deal.dailyHours != null && deal.dailyHours > 0
  ) {
    hourlyRate = deal.monthlyRevenue / deal.monthlyWorkdays / deal.dailyHours;
  } else if (settings.issueRules.zeroDivisor) {
    issues.push('時間当たり単価が計算不能（分母が0またはnull）');
  }

  // 異常値検出
  if (hourlyRate != null) {
    if (hourlyRate > settings.issueRules.extremeHourlyRateAbove) {
      issues.push(`時間当たり単価が異常に高い: ${Math.round(hourlyRate)}円`);
    }
    if (hourlyRate < settings.issueRules.extremeHourlyRateBelow) {
      issues.push(`時間当たり単価が異常に低い: ${Math.round(hourlyRate)}円`);
    }
  }

  // 係数と基本ポイント
  let hourlyCoef: number | null = null;
  let hourlyCoefLabel: string | null = null;
  if (hourlyRate != null && hourlyRate >= 0) {
    const c = determineCoef(hourlyRate, settings.hourlyCoefThresholds);
    hourlyCoef = c.coef;
    hourlyCoefLabel = c.label;
  }

  let basePoint: number | null = null;
  if (deal.msKbn === 'main') basePoint = settings.msPoints.main;
  else if (deal.msKbn === 'sub') basePoint = settings.msPoints.sub;
  else issues.push('MS区分が判定できない（メイン/サブどちらでもない）');

  // 獲得ポイント
  const hasIssue = issues.length > 0;
  const point = (hasIssue || basePoint == null || hourlyCoef == null) ? 0 : basePoint * hourlyCoef;

  // 集計用の年月（稼働開始日を優先、なければ登録日）
  const yearMonth = yearMonthOf(deal.operationStartDate) ?? yearMonthOf(deal.registeredAt);

  return {
    ...deal,
    hourlyRate: hourlyRate != null ? Math.round(hourlyRate) : null,
    hourlyCoef,
    hourlyCoefLabel,
    basePoint,
    point: Math.round(point * 100) / 100, // 小数2桁
    hasIssue,
    issues,
    yearMonth,
  };
}

export function computeAllDeals(deals: SfExtractDeal[], settings: KpiSettings): DealWithPoint[] {
  return deals.map(d => computeDealPoint(d, settings));
}
