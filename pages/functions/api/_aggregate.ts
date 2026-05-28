/**
 * 集計ロジック（Cloudflare Workers ランタイム用）
 * kpi-compute / firestore-sync の同等ロジックを移植
 */
export interface Deal {
  id: string;
  ownerName?: string;
  ownerEmail?: string;
  teamId?: string;
  yearMonth?: string;
  point: number;
  msKbn?: string;
  hourlyCoef?: number | null;
  hasIssue?: boolean;
  monthlyRevenue?: number;
}

export interface FinancialRow {
  dealId: string;
  yearMonth: string;
  revenue: number;
  grossProfit: number;
  ownerName?: string;
  teamId?: string;
}

export function yearMonthToFY(ym: string | null | undefined): string | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return 'FY' + (m >= 4 ? y : y - 1);
}

function coefLabel(coef: number | null | undefined): string {
  if (coef == null) return 'N/A';
  return 'x' + coef.toFixed(1);
}

export function aggregate(deals: Deal[]) {
  const memberMap = new Map<string, any>();
  for (const d of deals) {
    const key = d.ownerEmail ?? d.ownerName ?? 'unknown';
    if (!memberMap.has(key)) {
      memberMap.set(key, {
        teamId: d.teamId ?? '?',
        ownerName: d.ownerName ?? '?',
        ownerEmail: d.ownerEmail ?? '',
        totalPoint: 0, mainCount: 0, subCount: 0, totalDeals: 0, issueCount: 0,
        coefBreakdown: {},
      });
    }
    const m = memberMap.get(key);
    m.totalPoint += d.point;
    m.totalDeals++;
    if (d.msKbn === 'main') m.mainCount++;
    if (d.msKbn === 'sub') m.subCount++;
    if (d.hasIssue) m.issueCount++;
    const cl = coefLabel(d.hourlyCoef);
    m.coefBreakdown[cl] = (m.coefBreakdown[cl] ?? 0) + 1;
  }
  for (const m of memberMap.values()) m.totalPoint = Math.round(m.totalPoint * 100) / 100;

  const teamMap = new Map<string, any>();
  for (const m of memberMap.values()) {
    if (!teamMap.has(m.teamId)) {
      teamMap.set(m.teamId, {
        teamId: m.teamId,
        totalPoint: 0, mainCount: 0, subCount: 0,
        totalDeals: 0, memberCount: 0, issueCount: 0,
      });
    }
    const t = teamMap.get(m.teamId);
    t.totalPoint += m.totalPoint;
    t.mainCount += m.mainCount;
    t.subCount += m.subCount;
    t.totalDeals += m.totalDeals;
    t.memberCount++;
    t.issueCount += m.issueCount;
  }
  for (const t of teamMap.values()) t.totalPoint = Math.round(t.totalPoint * 100) / 100;

  const monthlyMap = new Map<string, any>();
  for (const d of deals) {
    if (!d.yearMonth) continue;
    if (!monthlyMap.has(d.yearMonth)) {
      monthlyMap.set(d.yearMonth, { yearMonth: d.yearMonth, totalPoint: 0, totalDeals: 0, byTeam: {} });
    }
    const ma = monthlyMap.get(d.yearMonth);
    ma.totalPoint += d.point;
    ma.totalDeals++;
    const t = d.teamId ?? '?';
    ma.byTeam[t] = (ma.byTeam[t] ?? 0) + d.point;
  }
  for (const ma of monthlyMap.values()) {
    ma.totalPoint = Math.round(ma.totalPoint * 100) / 100;
    for (const k of Object.keys(ma.byTeam)) ma.byTeam[k] = Math.round(ma.byTeam[k] * 100) / 100;
  }

  const members = Array.from(memberMap.values()).sort((a, b) => b.totalPoint - a.totalPoint);
  const teams = Array.from(teamMap.values()).sort((a, b) => b.totalPoint - a.totalPoint);
  const individualRanking = members.map((m, i) => ({
    rank: i + 1, ownerName: m.ownerName, teamId: m.teamId, point: m.totalPoint, deals: m.totalDeals,
  }));
  const teamRanking = teams.map((t, i) => ({ rank: i + 1, teamId: t.teamId, point: t.totalPoint }));
  const totalPoint = Math.round(deals.reduce((acc, d) => acc + d.point, 0) * 100) / 100;
  const totalDeals = deals.length;
  const totalIssues = deals.filter(d => d.hasIssue).length;

  return {
    totalPoint, totalDeals, totalIssues, members, teams,
    monthly: Array.from(monthlyMap.values()).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth)),
    rankings: { individual: individualRanking, team: teamRanking },
  };
}

export function aggregateByMonth(deals: Deal[]) {
  const byMonth = new Map<string, Deal[]>();
  for (const d of deals) {
    if (!d.yearMonth) continue;
    if (!byMonth.has(d.yearMonth)) byMonth.set(d.yearMonth, []);
    byMonth.get(d.yearMonth)!.push(d);
  }
  const result: Record<string, ReturnType<typeof aggregate>> = {};
  for (const [ym, ds] of byMonth) result[ym] = aggregate(ds);
  return result;
}

export function aggregateByFiscalYear(deals: Deal[]) {
  const byFy = new Map<string, Deal[]>();
  for (const d of deals) {
    const fy = yearMonthToFY(d.yearMonth);
    if (!fy) continue;
    if (!byFy.has(fy)) byFy.set(fy, []);
    byFy.get(fy)!.push(d);
  }
  const result: Record<string, ReturnType<typeof aggregate>> = {};
  for (const [fy, ds] of byFy) result[fy] = aggregate(ds);
  return result;
}

/**
 * 財務集計（年度内完結ルール適用）
 */
export function computeFinancials(deals: Deal[], rows: FinancialRow[]) {
  // 案件ID→獲得FY、メンバー、月間予定売上のマップ
  const dealMap = new Map<string, { fy: string; teamId: string; ownerName: string; ownerEmail: string; yearMonth: string; monthlyRevenue: number }>();
  for (const d of deals) {
    const fy = yearMonthToFY(d.yearMonth);
    if (!fy) continue;
    dealMap.set(d.id, {
      fy,
      teamId: d.teamId ?? '?',
      ownerName: d.ownerName ?? '?',
      ownerEmail: d.ownerEmail ?? '',
      yearMonth: d.yearMonth ?? '',
      monthlyRevenue: d.monthlyRevenue ?? 0,
    });
  }
  // 年度内完結ルール
  const validRows = rows.filter(r => {
    const d = dealMap.get(r.dealId);
    if (!d) return false;
    const recordFy = yearMonthToFY(r.yearMonth);
    return recordFy === d.fy;
  });

  // 全体・チーム別・メンバー別・月別・年度別
  type Fin = { revenue: number; grossProfit: number; dealCount: number };
  const newFin = (): Fin => ({ revenue: 0, grossProfit: 0, dealCount: 0 });
  let allRev = 0, allGp = 0;
  const allDeals = new Set<string>();
  const byTeam: Record<string, Fin & { _deals: Set<string> }> = {};
  const byMember: Record<string, Fin & { _deals: Set<string>; ownerName: string; teamId: string }> = {};
  const byMonth: Record<string, Fin & { _deals: Set<string> }> = {};
  const byFy: Record<string, Fin & { _deals: Set<string> }> = {};
  const teamByMonth: Record<string, Record<string, Fin & { _deals: Set<string> }>> = {};
  const teamByFy: Record<string, Record<string, Fin & { _deals: Set<string> }>> = {};

  for (const r of validRows) {
    const d = dealMap.get(r.dealId)!;
    const team = d.teamId;
    const rev = r.revenue || 0;
    const gp = r.grossProfit || 0;
    allRev += rev; allGp += gp;
    allDeals.add(r.dealId);

    if (!byTeam[team]) byTeam[team] = { ...newFin(), _deals: new Set() };
    byTeam[team].revenue += rev; byTeam[team].grossProfit += gp; byTeam[team]._deals.add(r.dealId);

    const memKey = d.ownerName + '|' + team;
    if (!byMember[memKey]) byMember[memKey] = { ...newFin(), _deals: new Set(), ownerName: d.ownerName, teamId: team };
    byMember[memKey].revenue += rev; byMember[memKey].grossProfit += gp; byMember[memKey]._deals.add(r.dealId);

    if (!byMonth[r.yearMonth]) byMonth[r.yearMonth] = { ...newFin(), _deals: new Set() };
    byMonth[r.yearMonth].revenue += rev; byMonth[r.yearMonth].grossProfit += gp; byMonth[r.yearMonth]._deals.add(r.dealId);

    if (!byFy[d.fy]) byFy[d.fy] = { ...newFin(), _deals: new Set() };
    byFy[d.fy].revenue += rev; byFy[d.fy].grossProfit += gp; byFy[d.fy]._deals.add(r.dealId);

    if (!teamByMonth[r.yearMonth]) teamByMonth[r.yearMonth] = {};
    if (!teamByMonth[r.yearMonth][team]) teamByMonth[r.yearMonth][team] = { ...newFin(), _deals: new Set() };
    teamByMonth[r.yearMonth][team].revenue += rev; teamByMonth[r.yearMonth][team].grossProfit += gp;
    teamByMonth[r.yearMonth][team]._deals.add(r.dealId);

    if (!teamByFy[d.fy]) teamByFy[d.fy] = {};
    if (!teamByFy[d.fy][team]) teamByFy[d.fy][team] = { ...newFin(), _deals: new Set() };
    teamByFy[d.fy][team].revenue += rev; teamByFy[d.fy][team].grossProfit += gp;
    teamByFy[d.fy][team]._deals.add(r.dealId);
  }

  // Setをcountに展開
  const pack = (x: Fin & { _deals: Set<string> }) => ({ revenue: x.revenue, grossProfit: x.grossProfit, dealCount: x._deals.size });

  // メンバー別ファイナンシャル (期間別)
  const memberFinancials: Record<string, any> = {};
  // 期間内獲得案件の月間予定売上と年度内累積実績
  for (const [dealId, d] of dealMap) {
    const memKey = d.ownerName;
    if (!memberFinancials[memKey]) memberFinancials[memKey] = { all: { plan: 0, cumRev: 0, cumGp: 0 }, byFy: {}, byMonth: {} };
    memberFinancials[memKey].all.plan += d.monthlyRevenue;
    if (!memberFinancials[memKey].byFy[d.fy]) memberFinancials[memKey].byFy[d.fy] = { plan: 0, cumRev: 0, cumGp: 0 };
    memberFinancials[memKey].byFy[d.fy].plan += d.monthlyRevenue;
    if (d.yearMonth) {
      if (!memberFinancials[memKey].byMonth[d.yearMonth]) memberFinancials[memKey].byMonth[d.yearMonth] = { plan: 0, cumRev: 0, cumGp: 0 };
      memberFinancials[memKey].byMonth[d.yearMonth].plan += d.monthlyRevenue;
    }
  }
  for (const r of validRows) {
    const d = dealMap.get(r.dealId)!;
    const memKey = d.ownerName;
    if (!memberFinancials[memKey]) memberFinancials[memKey] = { all: { plan: 0, cumRev: 0, cumGp: 0 }, byFy: {}, byMonth: {} };
    memberFinancials[memKey].all.cumRev += r.revenue || 0;
    memberFinancials[memKey].all.cumGp += r.grossProfit || 0;
    if (!memberFinancials[memKey].byFy[d.fy]) memberFinancials[memKey].byFy[d.fy] = { plan: 0, cumRev: 0, cumGp: 0 };
    memberFinancials[memKey].byFy[d.fy].cumRev += r.revenue || 0;
    memberFinancials[memKey].byFy[d.fy].cumGp += r.grossProfit || 0;
    if (d.yearMonth) {
      if (!memberFinancials[memKey].byMonth[d.yearMonth]) memberFinancials[memKey].byMonth[d.yearMonth] = { plan: 0, cumRev: 0, cumGp: 0 };
      memberFinancials[memKey].byMonth[d.yearMonth].cumRev += r.revenue || 0;
      memberFinancials[memKey].byMonth[d.yearMonth].cumGp += r.grossProfit || 0;
    }
  }

  const financials = {
    revenue: allRev,
    grossProfit: allGp,
    byTeam: Object.fromEntries(Object.entries(byTeam).map(([k, v]) => [k, pack(v)])),
    byMember: Object.fromEntries(Object.entries(byMember).map(([k, v]) => [k, { ...pack(v), ownerName: v.ownerName, teamId: v.teamId }])),
    byMonth: Object.fromEntries(Object.entries(byMonth).map(([k, v]) => [k, { revenue: v.revenue, grossProfit: v.grossProfit }])),
  };
  const financialsByPeriod: Record<string, any> = {};
  for (const [ym, agg] of Object.entries(byMonth)) {
    financialsByPeriod[ym] = { revenue: agg.revenue, grossProfit: agg.grossProfit, byTeam: {} };
  }
  for (const [ym, tmap] of Object.entries(teamByMonth)) {
    if (!financialsByPeriod[ym]) financialsByPeriod[ym] = { revenue: 0, grossProfit: 0, byTeam: {} };
    for (const [team, v] of Object.entries(tmap)) financialsByPeriod[ym].byTeam[team] = pack(v);
  }
  const financialsByFiscalYear: Record<string, any> = {};
  for (const [fy, agg] of Object.entries(byFy)) {
    financialsByFiscalYear[fy] = { revenue: agg.revenue, grossProfit: agg.grossProfit, byTeam: {} };
  }
  for (const [fy, tmap] of Object.entries(teamByFy)) {
    if (!financialsByFiscalYear[fy]) financialsByFiscalYear[fy] = { revenue: 0, grossProfit: 0, byTeam: {} };
    for (const [team, v] of Object.entries(tmap)) financialsByFiscalYear[fy].byTeam[team] = pack(v);
  }

  return { financials, financialsByPeriod, financialsByFiscalYear, memberFinancials, validRowCount: validRows.length };
}
