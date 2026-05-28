#!/usr/bin/env node
/**
 * firestore-sync CLI
 * 
 * ローカルの sf-extract / kpi-compute / csv-import の最新出力を Firestore に書き込む。
 * 
 * 使い方:
 *   npm run sync                          # 全て書込（自動検出）
 *   npm run sync -- --teams-members-only  # チーム・メンバーのみ
 *   npm run sync -- --skip-financials     # 実績書込みをスキップ
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, batchSet, deleteWhere, FieldValue, projectRoot } from './firestore.js';
import { aggregate, aggregateByMonth, aggregateByFiscalYear, type Deal } from './aggregate.js';

interface CliArgs {
  teamsOnly: boolean;
  skipFinancials: boolean;
  skipDeals: boolean;
  exportMembersJson: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { teamsOnly: false, skipFinancials: false, skipDeals: false, exportMembersJson: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--teams-members-only') args.teamsOnly = true;
    else if (a === '--skip-financials') args.skipFinancials = true;
    else if (a === '--skip-deals') args.skipDeals = true;
    else if (a === '--export-members-json') args.exportMembersJson = true;
    else if (a === '--help' || a === '-h') { console.log('Usage: see source'); process.exit(0); }
  }
  return args;
}

function latestFile(dir: string, suffix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(suffix))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(dir, files[0].name) : null;
}

function yearMonthToFY(ym: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return 'FY' + (m >= 4 ? y : y - 1);
}

async function syncTeamsAndMembers(): Promise<void> {
  console.log('[1/4] チーム・メンバーを Firestore に書込（merge方式、active/roleはWeb UI管理）');
  const membersPath = path.resolve(projectRoot, '..', 'sf-extract', 'config', 'members.json');
  if (!fs.existsSync(membersPath)) {
    console.warn('  members.json が見つかりません: ' + membersPath);
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(membersPath, 'utf-8'));

  // teams (merge方式: name/color/sortOrder のみ上書き、active等のWeb UI管理項目は保護)
  const teamItems = (cfg.teams || []).map((t: { id: string; name: string; color: string }, i: number) => ({
    id: t.id,
    data: {
      id: t.id,
      name: t.name,
      color: t.color,
      sortOrder: i + 1,
      updatedAt: FieldValue.serverTimestamp(),
      // active は触らない（Web UI管理。新規作成時は initActiveTeams ヘルパーで補完）
    }
  }));
  await batchSet('teams', teamItems, { merge: true });

  // members (merge方式: email/name/team のみ。role/active はWeb UI管理項目なので保護)
  const memberItems = (cfg.members || []).map((m: { name: string; email: string; team: string }) => ({
    id: m.email,
    data: {
      email: m.email,
      name: m.name,
      team: m.team,
      updatedAt: FieldValue.serverTimestamp(),
      // role / active は触らない（Web UI管理。新規作成時は initActiveMembers ヘルパーで補完）
    }
  }));
  await batchSet('members', memberItems, { merge: true });

  // 初期投入時のみ active: true / role: 'member' を補完（既存ドキュメントは変更しない）
  await initActiveDefaults();

  console.log('  完了: ' + teamItems.length + 'チーム / ' + memberItems.length + 'メンバー');
}

/**
 * 新規作成された teams/members ドキュメントに対し、未設定なら active: true をデフォルト付与。
 * 既に active が設定されている（trueでもfalseでも）ドキュメントには触らない。
 */
async function initActiveDefaults(): Promise<void> {
  // teams: active が未定義のドキュメントだけ true に
  const teamsSnap = await db.collection('teams').get();
  let teamFixCount = 0;
  for (const doc of teamsSnap.docs) {
    if (doc.data().active === undefined) {
      await doc.ref.set({ active: true }, { merge: true });
      teamFixCount++;
    }
  }
  if (teamFixCount > 0) console.log('  teams: ' + teamFixCount + '件に active:true をデフォルト付与');

  // members: active 未定義 → true、role 未定義 → 'member'
  const membersSnap = await db.collection('members').get();
  let memberFixCount = 0;
  for (const doc of membersSnap.docs) {
    const data = doc.data();
    const update: Record<string, unknown> = {};
    if (data.active === undefined) update.active = true;
    if (data.role === undefined) update.role = 'member';
    if (Object.keys(update).length > 0) {
      await doc.ref.set(update, { merge: true });
      memberFixCount++;
    }
  }
  if (memberFixCount > 0) console.log('  members: ' + memberFixCount + '件に active:true/role:member をデフォルト付与');
}

async function syncSettings(): Promise<void> {
  console.log('[2/4] 設定値を Firestore に書込');
  // kpi-settings
  const kpiPath = path.resolve(projectRoot, '..', 'kpi-compute', 'config', 'kpi-settings.json');
  if (fs.existsSync(kpiPath)) {
    const kpi = JSON.parse(fs.readFileSync(kpiPath, 'utf-8'));
    delete kpi.$comment; delete kpi.$notes;
    await db.collection('settings').doc('kpi').set({ ...kpi, updatedAt: FieldValue.serverTimestamp() });
    console.log('  settings/kpi 書込');
  }
  // filters (sf-extract columns)
  const colsPath = path.resolve(projectRoot, '..', 'sf-extract', 'config', 'columns.json');
  if (fs.existsSync(colsPath)) {
    const cols = JSON.parse(fs.readFileSync(colsPath, 'utf-8'));
    await db.collection('settings').doc('filters').set({
      ...cols.filters,
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log('  settings/filters 書込');
  }
}

async function syncDeals(): Promise<void> {
  console.log('[3/4] 案件データを Firestore に書込');
  const dealsPath = latestFile(path.resolve(projectRoot, '..', 'kpi-compute', 'output'), '_deals.json');
  if (!dealsPath) {
    console.warn('  kpi-compute の出力が見つかりません。先に npm run compute を実行してください');
    return;
  }
  console.log('  入力: ' + dealsPath);
  const data = JSON.parse(fs.readFileSync(dealsPath, 'utf-8'));
  const dealItems = (data.deals || []).map((d: Record<string, unknown>) => ({
    id: String(d.id),
    data: {
      ...d,
      fiscalYear: yearMonthToFY(String(d.yearMonth || '')) ?? null,
      raw: undefined, // raw を抜く（巨大すぎ）
      syncedAt: FieldValue.serverTimestamp(),
    }
  })).map((x: { id: string; data: Record<string, unknown> }) => {
    delete x.data.raw;
    return x;
  });

  // 🛡 安全ガード: SF取得結果が0件なら処理中断（認証エラー等で全件消すのを防ぐ）
  if (dealItems.length === 0) {
    console.warn('  ⚠ SFから取得した案件が0件です。書込・削除処理をスキップします（SF認証エラーやフィルタ全外れの可能性）');
    return;
  }

  // UPSERT書込
  await batchSet('deals', dealItems);
  console.log('  完了: ' + dealItems.length + '件の案件をUPSERT書込');

  // 🗑 差分削除: 今回のSF取得結果に含まれないFirestoreの案件を削除
  // （SF側で削除/失注/区分変更/スポット化/担当者外し等で対象外になった案件をクリーンアップ）
  const sfIdSet = new Set(dealItems.map((x: { id: string }) => x.id));
  const existingSnap = await db.collection('deals').get();
  const orphanIds: string[] = [];
  existingSnap.forEach(doc => { if (!sfIdSet.has(doc.id)) orphanIds.push(doc.id); });

  let orphansDeleted = 0;
  if (orphanIds.length === 0) {
    console.log('  孤立案件なし（SFと完全一致）');
  } else {
    // 🛡 安全ガード: 削除対象が異常に多い場合は警告ログを出す（実行は継続）
    const totalBefore = existingSnap.size;
    const ratio = totalBefore > 0 ? orphanIds.length / totalBefore : 0;
    if (orphanIds.length > 10 && ratio > 0.2) {
      console.warn('  ⚠ 削除対象が多めです: ' + orphanIds.length + '件 / 既存' + totalBefore + '件 (' + (ratio * 100).toFixed(1) + '%)');
      console.warn('    SF側で大量変更があったか、フィルタ条件が変わった可能性があります');
    }
    // バッチ削除（500件ずつ）
    for (let i = 0; i < orphanIds.length; i += 500) {
      const batch = db.batch();
      const slice = orphanIds.slice(i, i + 500);
      for (const id of slice) batch.delete(db.collection('deals').doc(id));
      await batch.commit();
    }
    orphansDeleted = orphanIds.length;
    console.log('  完了: ' + orphansDeleted + '件の孤立案件を削除');
    // サンプルとして先頭5件のIDをログ出力（追跡用）
    if (orphansDeleted > 0) {
      console.log('  削除ID例: ' + orphanIds.slice(0, 5).join(', ') + (orphansDeleted > 5 ? ' ...' : ''));
    }
  }

  // meta/sync_status
  await db.collection('meta').doc('sync_status').set({
    lastSfSync: FieldValue.serverTimestamp(),
    lastSfSyncDeals: dealItems.length,
    lastSfSyncOrphansDeleted: orphansDeleted,
    lastSfSyncBy: 'firestore-sync',
  }, { merge: true });

  // 集計サマリーを生成（active=true なメンバーのみ）
  await syncSummaries(data.deals || []);
}

/**
 * 全期間・FY別・月別の集計サマリーを Firestore に書き込む
 * （activeメンバー/activeチームの案件だけで集計）
 * 売上・粗利の財務集計も含めて、ダッシュボードはこれを読むだけで主要画面を描画できる
 */
async function syncSummaries(allDeals: Record<string, unknown>[]): Promise<void> {
  console.log('[3.5/4] 集計サマリーを Firestore に書込（active対象のみで集計）');

  // Firestoreからactive=trueなチーム・メンバーを取得
  const teamsSnap = await db.collection('teams').get();
  const membersSnap = await db.collection('members').get();
  const activeTeamIds = new Set<string>();
  teamsSnap.forEach(d => { if (d.data().active !== false) activeTeamIds.add(d.id); });
  const activeMemberEmails = new Set<string>();
  const activeMemberNames = new Set<string>();
  membersSnap.forEach(d => {
    const data = d.data();
    if (data.active === false) return;
    if (data.email) activeMemberEmails.add(data.email);
    if (data.name) activeMemberNames.add(data.name);
  });
  console.log('  active: ' + activeTeamIds.size + ' チーム / ' + activeMemberEmails.size + ' メンバー');

  // dealsをactiveでフィルタ
  const filteredRaw = allDeals.filter((d: Record<string, unknown>) => {
    const teamId = d.teamId as string | undefined;
    if (teamId && !activeTeamIds.has(teamId)) return false;
    const ownerEmail = d.ownerEmail as string | undefined;
    const ownerName = d.ownerName as string | undefined;
    if (ownerEmail) return activeMemberEmails.has(ownerEmail);
    if (ownerName) return activeMemberNames.has(ownerName);
    return false;
  });
  const filtered: Deal[] = filteredRaw.map((d: Record<string, unknown>) => ({
    id: String(d.id),
    ownerName: d.ownerName as string | undefined,
    ownerEmail: d.ownerEmail as string | undefined,
    teamId: d.teamId as string | undefined,
    yearMonth: d.yearMonth as string | undefined,
    point: Number(d.point) || 0,
    msKbn: d.msKbn as string | undefined,
    hourlyCoef: d.hourlyCoef as number | null | undefined,
    hasIssue: Boolean(d.hasIssue),
  }));
  console.log('  集計対象: ' + filtered.length + ' / ' + allDeals.length + ' 件（非アクティブ除外）');

  // ポイント集計
  const overall = aggregate(filtered);
  const byPeriod = aggregateByMonth(filtered);
  const byFy = aggregateByFiscalYear(filtered);

  // 財務集計（monthly_revenue を Firestore から取得して集計）
  // 月間予定売上は deals 側、売上/粗利実績は monthly_revenue 側
  console.log('  monthly_revenue を取得して財務集計を生成中...');
  const monthlySnap = await db.collection('monthly_revenue').get();
  const financialRows = monthlySnap.docs.map(d => d.data());
  console.log('  monthly_revenue: ' + financialRows.length + ' 行');

  // 案件ID→獲得FY のマップ
  const dealIdToFY: Record<string, string> = {};
  const dealIdToMember: Record<string, { ownerName: string; teamId: string; ownerEmail: string }> = {};
  const dealIdToMonthlyRevenue: Record<string, number> = {};
  for (const d of filteredRaw) {
    const id = String(d.id);
    const fy = yearMonthToFY(String(d.yearMonth || ''));
    if (fy) dealIdToFY[id] = fy;
    dealIdToMember[id] = {
      ownerName: String(d.ownerName || '?'),
      teamId: String(d.teamId || '?'),
      ownerEmail: String(d.ownerEmail || ''),
    };
    if (d.monthlyRevenue != null) {
      dealIdToMonthlyRevenue[id] = Number(d.monthlyRevenue) || 0;
    }
  }

  // 実績データを年度内完結ルールでフィルタ
  // 案件獲得FY === 実績月FY のもののみ採用
  const validFinancials = financialRows.filter(r => {
    const dealId = String(r.dealId || '');
    const acquiredFy = dealIdToFY[dealId];
    if (!acquiredFy) return false;
    const recordFy = yearMonthToFY(String(r.yearMonth || ''));
    return recordFy === acquiredFy;
  });

  // チーム/メンバーマスタ
  type FinAgg = { revenue: number; grossProfit: number; deals: Set<string> };
  const newFinAgg = (): FinAgg => ({ revenue: 0, grossProfit: 0, deals: new Set<string>() });

  // 全期間集計（年度内完結ルール適用）
  const totalsByTeam: Record<string, FinAgg> = {};
  const totalsByMember: Record<string, FinAgg & { ownerName: string; teamId: string }> = {};
  let grandRevenue = 0, grandGrossProfit = 0;
  // 月別
  const totalsByMonth: Record<string, FinAgg> = {};
  // FY別
  const totalsByFy: Record<string, FinAgg> = {};

  for (const r of validFinancials) {
    const dealId = String(r.dealId || '');
    const member = dealIdToMember[dealId];
    if (!member) continue;
    const team = member.teamId;
    const ym = String(r.yearMonth || '');
    const fy = yearMonthToFY(ym) || '?';
    const rev = Number(r.revenue) || 0;
    const gp = Number(r.grossProfit) || 0;

    grandRevenue += rev;
    grandGrossProfit += gp;

    if (!totalsByTeam[team]) totalsByTeam[team] = newFinAgg();
    totalsByTeam[team].revenue += rev;
    totalsByTeam[team].grossProfit += gp;
    totalsByTeam[team].deals.add(dealId);

    const memKey = member.ownerName + '|' + team;
    if (!totalsByMember[memKey]) totalsByMember[memKey] = { ...newFinAgg(), ownerName: member.ownerName, teamId: team };
    totalsByMember[memKey].revenue += rev;
    totalsByMember[memKey].grossProfit += gp;
    totalsByMember[memKey].deals.add(dealId);

    if (!totalsByMonth[ym]) totalsByMonth[ym] = newFinAgg();
    totalsByMonth[ym].revenue += rev;
    totalsByMonth[ym].grossProfit += gp;
    totalsByMonth[ym].deals.add(dealId);

    if (!totalsByFy[fy]) totalsByFy[fy] = newFinAgg();
    totalsByFy[fy].revenue += rev;
    totalsByFy[fy].grossProfit += gp;
    totalsByFy[fy].deals.add(dealId);
  }

  // メンバーごとの「期間内獲得案件の月間予定売上合計」と「年度内累積実績」を計算
  // ダッシュボードの個人ランキング用
  type MemberFinByPeriod = {
    all: { plan: number; cumRev: number; cumGp: number };
    byFy: Record<string, { plan: number; cumRev: number; cumGp: number }>;
    byMonth: Record<string, { plan: number; cumRev: number; cumGp: number }>;
  };
  const memberFin: Record<string, MemberFinByPeriod> = {};
  // 期間内獲得案件集合
  for (const d of filteredRaw) {
    const id = String(d.id);
    const member = dealIdToMember[id];
    if (!member) continue;
    const memKey = member.ownerName;
    const acquiredFy = dealIdToFY[id];
    if (!acquiredFy) continue;
    const ym = String(d.yearMonth || '');
    const plan = dealIdToMonthlyRevenue[id] || 0;
    if (!memberFin[memKey]) memberFin[memKey] = {
      all: { plan: 0, cumRev: 0, cumGp: 0 },
      byFy: {}, byMonth: {},
    };
    memberFin[memKey].all.plan += plan;
    if (!memberFin[memKey].byFy[acquiredFy]) memberFin[memKey].byFy[acquiredFy] = { plan: 0, cumRev: 0, cumGp: 0 };
    memberFin[memKey].byFy[acquiredFy].plan += plan;
    if (ym) {
      if (!memberFin[memKey].byMonth[ym]) memberFin[memKey].byMonth[ym] = { plan: 0, cumRev: 0, cumGp: 0 };
      memberFin[memKey].byMonth[ym].plan += plan;
    }
  }
  // 実績累積（年度内完結ルール適用済み）
  for (const r of validFinancials) {
    const dealId = String(r.dealId || '');
    const member = dealIdToMember[dealId];
    if (!member) continue;
    const memKey = member.ownerName;
    const acquiredFy = dealIdToFY[dealId];
    if (!acquiredFy) continue;
    const rev = Number(r.revenue) || 0;
    const gp = Number(r.grossProfit) || 0;
    const dealYm = String((filteredRaw.find(x => String(x.id) === dealId) || {}).yearMonth || '');
    if (!memberFin[memKey]) memberFin[memKey] = {
      all: { plan: 0, cumRev: 0, cumGp: 0 },
      byFy: {}, byMonth: {},
    };
    memberFin[memKey].all.cumRev += rev;
    memberFin[memKey].all.cumGp += gp;
    if (!memberFin[memKey].byFy[acquiredFy]) memberFin[memKey].byFy[acquiredFy] = { plan: 0, cumRev: 0, cumGp: 0 };
    memberFin[memKey].byFy[acquiredFy].cumRev += rev;
    memberFin[memKey].byFy[acquiredFy].cumGp += gp;
    if (dealYm) {
      if (!memberFin[memKey].byMonth[dealYm]) memberFin[memKey].byMonth[dealYm] = { plan: 0, cumRev: 0, cumGp: 0 };
      memberFin[memKey].byMonth[dealYm].cumRev += rev;
      memberFin[memKey].byMonth[dealYm].cumGp += gp;
    }
  }

  // 期間別financials（全体集計用）
  function packFin(agg: FinAgg) {
    return { revenue: agg.revenue, grossProfit: agg.grossProfit, dealCount: agg.deals.size };
  }
  const financialsByPeriod: Record<string, { revenue: number; grossProfit: number; byTeam: Record<string, ReturnType<typeof packFin>> }> = {};
  for (const [ym, agg] of Object.entries(totalsByMonth)) {
    financialsByPeriod[ym] = { revenue: agg.revenue, grossProfit: agg.grossProfit, byTeam: {} };
  }
  // チーム別×月別を作る
  const teamByMonth: Record<string, Record<string, FinAgg>> = {};
  for (const r of validFinancials) {
    const dealId = String(r.dealId || '');
    const member = dealIdToMember[dealId];
    if (!member) continue;
    const team = member.teamId;
    const ym = String(r.yearMonth || '');
    if (!teamByMonth[ym]) teamByMonth[ym] = {};
    if (!teamByMonth[ym][team]) teamByMonth[ym][team] = newFinAgg();
    teamByMonth[ym][team].revenue += Number(r.revenue) || 0;
    teamByMonth[ym][team].grossProfit += Number(r.grossProfit) || 0;
    teamByMonth[ym][team].deals.add(dealId);
  }
  for (const [ym, byTeamMap] of Object.entries(teamByMonth)) {
    if (!financialsByPeriod[ym]) financialsByPeriod[ym] = { revenue: 0, grossProfit: 0, byTeam: {} };
    for (const [team, agg] of Object.entries(byTeamMap)) {
      financialsByPeriod[ym].byTeam[team] = packFin(agg);
    }
  }
  // 年度別の財務（全体）
  const financialsByFy: Record<string, { revenue: number; grossProfit: number; byTeam: Record<string, ReturnType<typeof packFin>> }> = {};
  for (const [fy, agg] of Object.entries(totalsByFy)) {
    financialsByFy[fy] = { revenue: agg.revenue, grossProfit: agg.grossProfit, byTeam: {} };
  }
  const teamByFy: Record<string, Record<string, FinAgg>> = {};
  for (const r of validFinancials) {
    const dealId = String(r.dealId || '');
    const member = dealIdToMember[dealId];
    if (!member) continue;
    const team = member.teamId;
    const fy = yearMonthToFY(String(r.yearMonth || '')) || '?';
    if (!teamByFy[fy]) teamByFy[fy] = {};
    if (!teamByFy[fy][team]) teamByFy[fy][team] = newFinAgg();
    teamByFy[fy][team].revenue += Number(r.revenue) || 0;
    teamByFy[fy][team].grossProfit += Number(r.grossProfit) || 0;
    teamByFy[fy][team].deals.add(dealId);
  }
  for (const [fy, byTeamMap] of Object.entries(teamByFy)) {
    if (!financialsByFy[fy]) financialsByFy[fy] = { revenue: 0, grossProfit: 0, byTeam: {} };
    for (const [team, agg] of Object.entries(byTeamMap)) {
      financialsByFy[fy].byTeam[team] = packFin(agg);
    }
  }
  // 全体財務
  const financialsAll = {
    revenue: grandRevenue,
    grossProfit: grandGrossProfit,
    byTeam: Object.fromEntries(Object.entries(totalsByTeam).map(([t, a]) => [t, packFin(a)])),
    byMember: Object.fromEntries(Object.entries(totalsByMember).map(([k, a]) => [k, { ...packFin(a), ownerName: a.ownerName, teamId: a.teamId }])),
    byMonth: Object.fromEntries(Object.entries(totalsByMonth).map(([k, a]) => [k, { revenue: a.revenue, grossProfit: a.grossProfit }])),
  };

  // Firestore書込 (summary/aggregate ドキュメント1件に全部入れる)
  await db.collection('summary').doc('aggregate').set({
    computedAt: FieldValue.serverTimestamp(),
    aggregate: overall,
    aggregateByPeriod: byPeriod,
    aggregateByFiscalYear: byFy,
    financials: financialsAll,
    financialsByPeriod,
    financialsByFiscalYear: financialsByFy,
    memberFinancials: memberFin,
    activeMemberCount: activeMemberEmails.size,
    activeTeamCount: activeTeamIds.size,
    sourceDeals: filtered.length,
    totalDeals: allDeals.length,
    sourceFinancialRows: validFinancials.length,
  });
  console.log('  完了: summary/aggregate に書込（財務含む）');
}

async function syncFinancials(): Promise<void> {
  console.log('[4/4] 実績データ (CSV) を Firestore に書込');
  const finPath = latestFile(path.resolve(projectRoot, '..', 'csv-import', 'output'), '.json');
  if (!finPath) {
    console.warn('  csv-import の出力が見つかりません。先に npm run import を実行してください');
    return;
  }
  console.log('  入力: ' + finPath);
  const data = JSON.parse(fs.readFileSync(finPath, 'utf-8'));
  const rows = data.matchedRows || [];

  // 取込対象の月一覧
  const months = Array.from(new Set(rows.map((r: { yearMonth: string }) => r.yearMonth))) as string[];
  console.log('  対象月: ' + months.join(', '));

  // UPSERT: まず該当月のドキュメントを全削除
  for (const ym of months) {
    const deleted = await deleteWhere('monthly_revenue', 'yearMonth', ym);
    console.log('  ' + ym + ': 既存 ' + deleted + ' 件削除');
  }

  // 新データを書込
  const items = rows.map((r: { yearMonth: string; dealId: string; manualNo: string; ownerName: string | null; teamId: string | null; revenue: number; grossProfit: number; workdays: number }) => ({
    id: r.yearMonth + '_' + r.dealId,
    data: {
      yearMonth: r.yearMonth,
      fiscalYear: yearMonthToFY(r.yearMonth) ?? null,
      dealId: r.dealId,
      manualNo: r.manualNo,
      ownerName: r.ownerName,
      teamId: r.teamId,
      revenue: r.revenue,
      grossProfit: r.grossProfit,
      workdays: r.workdays,
      uploadedAt: FieldValue.serverTimestamp(),
      uploadedBy: 'firestore-sync',
      sourceFile: path.basename(finPath),
    }
  }));
  await batchSet('monthly_revenue', items);
  console.log('  完了: ' + items.length + '件の実績を書込');

  // meta/sync_status 更新
  await db.collection('meta').doc('sync_status').set({
    lastCsvImport: FieldValue.serverTimestamp(),
    lastCsvImportMonths: months,
    lastCsvImportRows: items.length,
    lastCsvImportBy: 'firestore-sync',
  }, { merge: true });
}

/**
 * Firestoreから sf-extract/config/members.json を生成。
 * 方針: SF SOQL は active 状態に関わらず全員分取得し続ける（データ復活を即時に保つため）。
 * 非アクティブメンバーの「集計除外」はダッシュボード側で行う。
 * チームは active=false を除外（チーム自体が消える＝紐づくメンバーも members.json から落ちる）。
 */
async function exportMembersJson(): Promise<void> {
  console.log('[export] Firestore → sf-extract/config/members.json を生成（SF取得は全員分維持）');
  const teamsSnap = await db.collection('teams').get();
  const membersSnap = await db.collection('members').get();

  const teams = teamsSnap.docs
    .map(d => d.data())
    .filter(t => t.active !== false) // active未定義もtrueと見做す
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(t => ({ id: t.id, name: t.name, color: t.color }));

  const activeTeamIds = new Set(teams.map(t => t.id));

  // メンバーは active 関係なく全員（SF取得対象として維持）
  // ただし、所属チームが非アクティブな場合は members.json に含めない（紐付け先がないため）
  const members = membersSnap.docs
    .map(d => d.data())
    .filter(m => activeTeamIds.has(m.team))
    .map(m => ({ name: m.name, email: m.email, team: m.team }));

  const out = { teams, members };
  const outPath = path.resolve(projectRoot, '..', 'sf-extract', 'config', 'members.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log('  書出: ' + outPath);
  console.log('  チーム ' + teams.length + ' 件 / メンバー ' + members.length + ' 件（active関係なくSF SOQL対象）');
}

async function main(): Promise<void> {
  const args = parseArgs();
  const start = Date.now();
  console.log('[firestore-sync] 開始');

  try {
    // モード1: Firestore → members.json 書出のみ（GitHub Actions の sf-extract 実行前で使う）
    if (args.exportMembersJson) {
      await exportMembersJson();
      console.log('[firestore-sync] members.json 書出完了 (' + ((Date.now() - start) / 1000).toFixed(1) + ' 秒)');
      process.exit(0);
    }

    // モード2: 通常の同期
    await syncTeamsAndMembers();
    if (args.teamsOnly) {
      console.log('[firestore-sync] チーム・メンバーのみ完了');
      return;
    }
    await syncSettings();
    if (!args.skipDeals) await syncDeals();
    if (!args.skipFinancials) await syncFinancials();
  } catch (err) {
    console.error('[firestore-sync] エラー:', err instanceof Error ? err.message : err);
    if (err instanceof Error) console.error(err.stack);
    process.exit(1);
  }

  console.log('[firestore-sync] 完了 (' + ((Date.now() - start) / 1000).toFixed(1) + ' 秒)');
  process.exit(0);
}

main();
