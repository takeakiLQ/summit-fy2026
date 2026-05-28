#!/usr/bin/env node
/**
 * sf-extract CLI エントリポイント
 *
 * 使い方:
 *   npm run extract                   # 通常実行（columns.jsonのfiltersを適用）
 *   npm run extract -- --describe     # Oppotunities__cのスキーマを取得
 *   npm run extract -- --out PATH     # 出力先指定
 */
import fs from 'node:fs';
import path from 'node:path';
import { env, paths, loadColumns, loadMembers, debug } from './config.js';
import { getAccessToken } from './auth.js';
import { SalesforceClient } from './sfClient.js';
import { extractDeals } from './extractDeals.js';

interface CliArgs {
  describe: boolean;
  clientSideFilter: boolean;
  out: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { describe: false, clientSideFilter: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--describe') args.describe = true;
    else if (a === '--client-side-filter') args.clientSideFilter = true;
    else if (a === '--out' && argv[i + 1]) { args.out = argv[++i] ?? null; }
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp(): void {
  console.log(`sf-extract — Salesforce 案件データ抽出 CLI

Usage:
  npm run extract -- [options]

Options:
  --describe                Oppotunities__cのスキーマをJSONで表示（フィールドAPI名確認用）
  --client-side-filter      担当者フィルタをSOQLではなくクライアント側で実施
  --out PATH                出力ファイルパス（デフォルト: output/deals-YYYYMMDD-HHMMSS.json）
  --help                    このヘルプを表示

抽出条件は config/columns.json の filters で制御:
  - statusInclude:            ['配車済み', '稼働終了']
  - classificationInclude:    ['新規', '増車', '新増', '復活']
  - msKbnInclude:             ['メイン', 'サブ']  (スポット除外)
  - operationStartFrom:       '2026-04-01'        (稼働開始日 以降)
担当者は config/members.json の氏名 OR メアド どちらか一致でフィルタ。
`);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('[sf-extract] Salesforce アクセストークンを取得中...');
  const token = await getAccessToken();
  console.log('[sf-extract] 認証成功. instance=' + token.instanceUrl);

  const client = new SalesforceClient(token);
  const columns = loadColumns();
  const members = loadMembers();

  if (args.describe) {
    console.log('[sf-extract] ' + columns.objectApiName + ' のスキーマを取得中...');
    const describe = await client.describe(columns.objectApiName);
    const fields = (describe['fields'] as Array<Record<string, unknown>> | undefined) ?? [];
    const summary = fields.map(f => ({
      name: f['name'],
      label: f['label'],
      type: f['type'],
      custom: f['custom'],
      length: f['length'],
      referenceTo: f['referenceTo'],
      relationshipName: f['relationshipName'],
      picklistValues: Array.isArray(f['picklistValues'])
        ? (f['picklistValues'] as Array<Record<string, unknown>>).map(p => p['value']) : undefined,
    }));
    console.log(JSON.stringify({ object: columns.objectApiName, totalFields: summary.length, fields: summary }, null, 2));
    return;
  }

  console.log('[sf-extract] 案件取得開始. object=' + columns.objectApiName);
  if (columns.filters.operationStartFrom) {
    console.log('[sf-extract] 稼働開始日フィルタ: >= ' + columns.filters.operationStartFrom);
  }

  const result = await extractDeals(client, columns, members, {
    filterClientSide: args.clientSideFilter,
  });

  console.log('[sf-extract] 取得完了:');
  console.log('             SF返却件数: ' + result.totalFetched);
  console.log('             対象件数  : ' + result.totalIncluded);
  console.log('             除外件数  : ' + result.totalExcluded);
  if (result.excludedReason.length > 0) {
    console.log('             除外内訳  :');
    for (const r of result.excludedReason) console.log('               - ' + r.reason + ': ' + r.count + '件');
  }

  // メンバー別取得状況
  console.log('');
  console.log('[sf-extract] メンバー別取得状況:');
  const byTeam = new Map<string, typeof result.ownerDirectory>();
  for (const d of result.ownerDirectory) {
    if (!byTeam.has(d.team)) byTeam.set(d.team, []);
    byTeam.get(d.team)!.push(d);
  }
  for (const [team, ds] of Array.from(byTeam.entries()).sort()) {
    console.log('  ' + team + ':');
    for (const d of ds) {
      const flag = !d.matched ? ' ⚠ 0件' : '';
      const matchInfo = d.matched ? ` [${d.matchedBy}]` : '';
      console.log('    ' + d.configName.padEnd(12) + ' ' + String(d.dealCount).padStart(4) + '件' + matchInfo + flag);
    }
  }

  fs.mkdirSync(paths.outputDir, { recursive: true });
  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(paths.outputDir, 'deals-' + timestamp() + '.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log('');
  console.log('[sf-extract] JSON出力: ' + outPath);
}

main().catch(err => {
  console.error('[sf-extract] エラー:', err instanceof Error ? err.message : err);
  if (env.DEBUG && err instanceof Error) console.error(err.stack);
  process.exit(1);
});
