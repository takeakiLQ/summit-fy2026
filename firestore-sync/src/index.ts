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

interface CliArgs {
  teamsOnly: boolean;
  skipFinancials: boolean;
  skipDeals: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { teamsOnly: false, skipFinancials: false, skipDeals: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--teams-members-only') args.teamsOnly = true;
    else if (a === '--skip-financials') args.skipFinancials = true;
    else if (a === '--skip-deals') args.skipDeals = true;
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
  console.log('[1/4] チーム・メンバーを Firestore に書込');
  const membersPath = path.resolve(projectRoot, '..', 'sf-extract', 'config', 'members.json');
  if (!fs.existsSync(membersPath)) {
    console.warn('  members.json が見つかりません: ' + membersPath);
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(membersPath, 'utf-8'));

  // teams
  const teamItems = (cfg.teams || []).map((t: { id: string; name: string; color: string }, i: number) => ({
    id: t.id,
    data: { id: t.id, name: t.name, color: t.color, sortOrder: i + 1, updatedAt: FieldValue.serverTimestamp() }
  }));
  await batchSet('teams', teamItems);

  // members（既存の role を保持するため merge）
  const memberItems = (cfg.members || []).map((m: { name: string; email: string; team: string }) => ({
    id: m.email,
    data: {
      email: m.email,
      name: m.name,
      team: m.team,
      role: 'member',
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    }
  }));
  await batchSet('members', memberItems, { merge: true });
  console.log('  完了: ' + teamItems.length + 'チーム / ' + memberItems.length + 'メンバー');
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

  await batchSet('deals', dealItems);
  console.log('  完了: ' + dealItems.length + '件の案件を書込');

  // meta/sync_status
  await db.collection('meta').doc('sync_status').set({
    lastSfSync: FieldValue.serverTimestamp(),
    lastSfSyncDeals: dealItems.length,
    lastSfSyncBy: 'firestore-sync',
  }, { merge: true });
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

async function main(): Promise<void> {
  const args = parseArgs();
  const start = Date.now();
  console.log('[firestore-sync] 開始');

  try {
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
