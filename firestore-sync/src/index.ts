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
