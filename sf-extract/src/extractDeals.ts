/**
 * 案件抽出ロジック
 * - SF認証 → SOQL → メンバーフィルタ → 論理名に変換
 * - 担当者は 氏名 OR メアド どちらかで照合（表記揺れ救済）
 * - 稼働開始日でフィルタ済みのデータを受け取る前提
 */
import type { SalesforceClient } from './sfClient.js';
import { buildDealQuery, type BuildQueryOptions } from './soql.js';
import type { ColumnsConfig, MembersConfig } from './config.js';
import { debug } from './config.js';

export interface NormalizedDeal {
  id: string;
  name: string;
  manualNo: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerNameRaw: string | null;
  ownerEmailRaw: string | null;
  matchedBy: 'name' | 'email' | null;
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
  groupFy22: string | null;
  kind: 'ByQ' | 'Qhai';
  raw: Record<string, unknown>;
}

export interface ExtractResult {
  exportedAt: string;
  objectApiName: string;
  soql: string;
  totalFetched: number;
  totalIncluded: number;
  totalExcluded: number;
  excludedReason: { reason: string; count: number; samples: string[] }[];
  deals: NormalizedDeal[];
  /** メンバー名簿の氏名→SF実名・SFメアドの対応マップ（メンバー側で更新するために出力） */
  ownerDirectory: { configName: string; configEmail: string; team: string;
                    matched: boolean; matchedBy?: 'name'|'email';
                    sfName?: string; sfEmail?: string; dealCount: number }[];
}

export interface ExtractOptions extends BuildQueryOptions {
  filterClientSide?: boolean;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function toString(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function normalizeMsKbn(raw: unknown, mapping?: { main?: string; sub?: string }): 'main' | 'sub' | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (mapping?.main && s === mapping.main) return 'main';
  if (mapping?.sub && s === mapping.sub) return 'sub';
  if (/^main$/i.test(s) || s.includes('メイン')) return 'main';
  if (/^sub$/i.test(s) || s.includes('サブ')) return 'sub';
  return null;
}

export async function extractDeals(
  client: SalesforceClient,
  columns: ColumnsConfig,
  members: MembersConfig,
  options: ExtractOptions = {}
): Promise<ExtractResult> {
  const targetNames = members.members.map(m => m.name);
  const targetEmails = members.members.map(m => m.email).filter(e => !!e);

  // 氏名 → member、メアド(lower) → member の両方のマップ
  const nameToMember = new Map(members.members.map(m => [m.name, m]));
  const emailToMember = new Map(members.members.map(m => [m.email.toLowerCase(), m]));

  const queryOptions: BuildQueryOptions = {
    ...options,
    ownerNames: options.filterClientSide ? undefined : targetNames,
    ownerEmails: options.filterClientSide ? undefined : targetEmails,
  };
  const soql = buildDealQuery(columns, queryOptions);
  debug('SOQL:', soql);

  const raws = await client.queryAll<Record<string, unknown>>(soql);
  debug(`raws fetched: ${raws.length}`);

  const f = columns.fields;
  const msMapping = columns.$msKbnValues;

  const deals: NormalizedDeal[] = [];
  const excludedMap = new Map<string, { count: number; samples: string[] }>();
  const recordExcluded = (reason: string, sample: string) => {
    const entry = excludedMap.get(reason) ?? { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 3) entry.samples.push(sample);
    excludedMap.set(reason, entry);
  };

  // メンバーごとのカウント
  const memberDealCount = new Map<string, number>();
  const memberSfInfo = new Map<string, { sfName: string; sfEmail: string; matchedBy: 'name'|'email' }>();

  for (const r of raws) {
    const sfName = toString(getByPath(r, f.ownerName));
    const sfEmail = f.ownerEmail ? toString(getByPath(r, f.ownerEmail)) : null;

    // 氏名→メアドの優先順でマッチ
    let member: MembersConfig['members'][number] | undefined;
    let matchedBy: 'name' | 'email' | null = null;

    if (sfName) {
      const m = nameToMember.get(sfName);
      if (m) { member = m; matchedBy = 'name'; }
    }
    if (!member && sfEmail) {
      const m = emailToMember.get(sfEmail.toLowerCase());
      if (m) { member = m; matchedBy = 'email'; }
    }

    if (!member) {
      recordExcluded('本チーム員ではない', (sfName ?? '?') + ' / ' + (sfEmail ?? '?'));
      continue;
    }

    memberDealCount.set(member.email, (memberDealCount.get(member.email) ?? 0) + 1);
    if (!memberSfInfo.has(member.email)) {
      memberSfInfo.set(member.email, { sfName: sfName ?? '', sfEmail: sfEmail ?? '', matchedBy: matchedBy! });
    }

    deals.push({
      id: toString(r[f.id]) ?? '',
      name: toString(r[f.name]) ?? '',
      manualNo: toString(r[f.manualNo]),
      ownerName: member.name,
      ownerEmail: member.email,
      ownerNameRaw: sfName,
      ownerEmailRaw: sfEmail,
      matchedBy,
      teamId: member.team,
      msKbnRaw: r[f.msKbn] ?? null,
      msKbn: normalizeMsKbn(r[f.msKbn], msMapping),
      monthlyRevenue: toNumber(r[f.monthlyRevenue]),
      contractPrice: toNumber(r[f.contractPrice]),
      monthlyWorkdays: toNumber(r[f.monthlyWorkdays]),
      dailyHours: toNumber(r[f.dailyHours]),
      status: toString(r[f.status]),
      classification: toString(r[f.classification]),
      operationStartDate: toString(r[f.operationStartDate]),
      plannedStartDate: f.plannedStartDate ? toString(r[f.plannedStartDate]) : null,
      registeredAt: toString(r[f.registeredAt]),
      lastModifiedAt: toString(r[f.lastModifiedAt]),
      groupFy22: f.groupFy22 ? toString(r[f.groupFy22]) : null,
      kind: (f.groupFy22 && toString(r[f.groupFy22]) === '都市物流営業部（緊急便）') ? 'ByQ' : 'Qhai',
      raw: r,
    });
  }

  // ownerDirectory（メンバー名簿の補助情報）
  const ownerDirectory = members.members.map(m => {
    const info = memberSfInfo.get(m.email);
    return {
      configName: m.name,
      configEmail: m.email,
      team: m.team,
      matched: !!info,
      matchedBy: info?.matchedBy,
      sfName: info?.sfName,
      sfEmail: info?.sfEmail,
      dealCount: memberDealCount.get(m.email) ?? 0,
    };
  });

  const excludedReason = Array.from(excludedMap.entries()).map(([reason, e]) => ({
    reason,
    count: e.count,
    samples: e.samples,
  }));

  return {
    exportedAt: new Date().toISOString(),
    objectApiName: columns.objectApiName,
    soql,
    totalFetched: raws.length,
    totalIncluded: deals.length,
    totalExcluded: raws.length - deals.length,
    excludedReason,
    deals,
    ownerDirectory,
  };
}
