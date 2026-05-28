/**
 * 集計ロジック（kpi-compute/src/aggregate.tsからコピーして同居）
 * activeメンバーのみで集計するために、firestore-sync側で再計算する
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
}

export interface MemberAggregate {
  teamId: string;
  ownerName: string;
  ownerEmail: string;
  totalPoint: number;
  mainCount: number;
  subCount: number;
  totalDeals: number;
  issueCount: number;
  coefBreakdown: Record<string, number>;
}

export interface TeamAggregate {
  teamId: string;
  totalPoint: number;
  mainCount: number;
  subCount: number;
  totalDeals: number;
  memberCount: number;
  issueCount: number;
}

export interface MonthlyAggregate {
  yearMonth: string;
  totalPoint: number;
  totalDeals: number;
  byTeam: Record<string, number>;
}

export interface AggregateResult {
  totalPoint: number;
  totalDeals: number;
  totalIssues: number;
  members: MemberAggregate[];
  teams: TeamAggregate[];
  monthly: MonthlyAggregate[];
  rankings: {
    individual: { rank: number; ownerName: string; teamId: string; point: number; deals: number }[];
    team: { rank: number; teamId: string; point: number }[];
  };
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

export function aggregate(deals: Deal[]): AggregateResult {
  const memberMap = new Map<string, MemberAggregate>();
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
    const m = memberMap.get(key)!;
    m.totalPoint += d.point;
    m.totalDeals++;
    if (d.msKbn === 'main') m.mainCount++;
    if (d.msKbn === 'sub') m.subCount++;
    if (d.hasIssue) m.issueCount++;
    const cl = coefLabel(d.hourlyCoef);
    m.coefBreakdown[cl] = (m.coefBreakdown[cl] ?? 0) + 1;
  }
  for (const m of memberMap.values()) m.totalPoint = Math.round(m.totalPoint * 100) / 100;

  const teamMap = new Map<string, TeamAggregate>();
  for (const m of memberMap.values()) {
    if (!teamMap.has(m.teamId)) {
      teamMap.set(m.teamId, {
        teamId: m.teamId,
        totalPoint: 0, mainCount: 0, subCount: 0,
        totalDeals: 0, memberCount: 0, issueCount: 0,
      });
    }
    const t = teamMap.get(m.teamId)!;
    t.totalPoint += m.totalPoint;
    t.mainCount += m.mainCount;
    t.subCount += m.subCount;
    t.totalDeals += m.totalDeals;
    t.memberCount++;
    t.issueCount += m.issueCount;
  }
  for (const t of teamMap.values()) t.totalPoint = Math.round(t.totalPoint * 100) / 100;

  const monthlyMap = new Map<string, MonthlyAggregate>();
  for (const d of deals) {
    if (!d.yearMonth) continue;
    if (!monthlyMap.has(d.yearMonth)) {
      monthlyMap.set(d.yearMonth, { yearMonth: d.yearMonth, totalPoint: 0, totalDeals: 0, byTeam: {} });
    }
    const ma = monthlyMap.get(d.yearMonth)!;
    ma.totalPoint += d.point;
    ma.totalDeals++;
    const t = d.teamId ?? '?';
    ma.byTeam[t] = (ma.byTeam[t] ?? 0) + d.point;
  }
  for (const ma of monthlyMap.values()) {
    ma.totalPoint = Math.round(ma.totalPoint * 100) / 100;
    for (const k of Object.keys(ma.byTeam)) ma.byTeam[k] = Math.round(ma.byTeam[k]! * 100) / 100;
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

export function aggregateByMonth(deals: Deal[]): Record<string, AggregateResult> {
  const byMonth = new Map<string, Deal[]>();
  for (const d of deals) {
    if (!d.yearMonth) continue;
    if (!byMonth.has(d.yearMonth)) byMonth.set(d.yearMonth, []);
    byMonth.get(d.yearMonth)!.push(d);
  }
  const result: Record<string, AggregateResult> = {};
  for (const [ym, ds] of byMonth) result[ym] = aggregate(ds);
  return result;
}

export function aggregateByFiscalYear(deals: Deal[]): Record<string, AggregateResult> {
  const byFy = new Map<string, Deal[]>();
  for (const d of deals) {
    const fy = yearMonthToFY(d.yearMonth);
    if (!fy) continue;
    if (!byFy.has(fy)) byFy.set(fy, []);
    byFy.get(fy)!.push(d);
  }
  const result: Record<string, AggregateResult> = {};
  for (const [fy, ds] of byFy) result[fy] = aggregate(ds);
  return result;
}
