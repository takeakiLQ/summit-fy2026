/**
 * sf-extract の出力JSON型定義（kpi-computeで使う部分のみ）
 */
export interface SfExtractDeal {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  teamId: string | null;
  msKbnRaw: unknown;
  msKbn: 'main' | 'sub' | null;
  monthlyRevenue: number | null;
  contractPrice: number | null;
  monthlyWorkdays: number | null;
  dailyHours: number | null;
  status: string | null;
  classification: string | null;
  operationStartDate: string | null;
  plannedStartDate: string | null;
  registeredAt: string | null;
  lastModifiedAt: string | null;
}

export interface SfExtractResult {
  exportedAt: string;
  objectApiName: string;
  soql?: string;
  totalFetched: number;
  totalIncluded: number;
  totalExcluded: number;
  deals: SfExtractDeal[];
  ownerDirectory?: { configName: string; configEmail: string; team: string;
                     matched: boolean; matchedBy?: 'name'|'email';
                     sfName?: string; sfEmail?: string; dealCount: number }[];
}

export interface KpiSettings {
  msPoints: { main: number; sub: number };
  hourlyCoefThresholds: { min: number; coef: number; label?: string }[];
  issueRules: {
    missingDailyHours: boolean;
    missingMonthlyWorkdays: boolean;
    missingMonthlyRevenue: boolean;
    zeroDivisor: boolean;
    extremeHourlyRateAbove: number;
    extremeHourlyRateBelow: number;
  };
}

/** KPI計算後の案件（元のdealにポイント情報を付与） */
export interface DealWithPoint extends SfExtractDeal {
  /** 時間当たり単価（計算可能なら） */
  hourlyRate: number | null;
  /** 適用された時間当たり係数 */
  hourlyCoef: number | null;
  /** メイン/サブのベースポイント */
  basePoint: number | null;
  /** 獲得ポイント = basePoint × hourlyCoef */
  point: number;
  /** 要修正案件か */
  hasIssue: boolean;
  /** 検出された問題の一覧 */
  issues: string[];
  /** どの閾値レンジに属するか（ラベル） */
  hourlyCoefLabel: string | null;
  /** 集計に使う年月 (YYYY-MM)。operationStartDate を優先、なければ registeredAt */
  yearMonth: string | null;
}
