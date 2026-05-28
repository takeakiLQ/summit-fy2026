export interface CsvMappingConfig {
  encoding: string;
  columns: {
    yearMonth: string;
    manualNo: string;
    revenueTotal: string;
    costTotal: string;
    cpCostTotal: string;
    workdays: string;
  };
}

export interface RawCsvRow {
  yearMonthRaw: string;
  manualNoRaw: string;
  revenueTotal: number;
  costTotal: number;
  cpCostTotal: number;
  workdays: number;
  lineNumber: number;
}

export interface MonthlyRevenue {
  yearMonth: string;        // YYYY-MM
  manualNo: string;
  revenue: number;          // 売上 = revenueTotal
  grossProfit: number;      // 粗利 = revenueTotal - cpCostTotal
  workdays: number;
}

export interface MatchedRevenue extends MonthlyRevenue {
  dealId: string | null;
  dealName: string | null;
  ownerName: string | null;
  teamId: string | null;
  matched: boolean;
}

export interface ImportResult {
  importedAt: string;
  sourceFile: string;
  totalRows: number;
  parsedRows: number;
  parseErrors: { line: number; message: string }[];
  matched: number;
  unmatched: number;
  matchedRows: MatchedRevenue[];
  unmatchedManualNos: string[];
  unmatchedDeals: { manualNo: string | null; dealId: string; name: string; ownerName: string | null; teamId: string | null }[];
  totals: {
    revenue: number;
    grossProfit: number;
    byTeam: Record<string, { revenue: number; grossProfit: number; deals: number }>;
    byMember: Record<string, { ownerName: string; teamId: string; revenue: number; grossProfit: number; deals: number }>;
  };
}

/** sf-extract出力JSON型（必要な部分のみ） */
export interface SfExtractDeal {
  id: string;
  name: string;
  manualNo: string | null;
  ownerName: string | null;
  teamId: string | null;
}

export interface SfExtractResult {
  deals: SfExtractDeal[];
}
