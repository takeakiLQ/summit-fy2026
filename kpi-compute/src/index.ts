#!/usr/bin/env node
/**
 * kpi-compute CLI
 *
 * 使い方:
 *   npm run compute -- --in ../sf-extract/output/deals-v2.json
 *   npm run compute -- --in ./deals.json --out ./output/result.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadKpiSettings, loadDealsJson, projectRoot } from './config.js';
import { computeAllDeals } from './compute.js';
import { aggregate, aggregateByMonth, aggregateByFiscalYear } from './aggregate.js';

interface CliArgs {
  inPath: string | null;
  outDir: string;
  outBase: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { inPath: null, outDir: path.join(projectRoot, 'output'), outBase: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--in' || a === '-i') && argv[i + 1]) { args.inPath = argv[++i] ?? null; }
    else if (a === '--out-dir' && argv[i + 1]) { args.outDir = argv[++i] ?? args.outDir; }
    else if (a === '--out-base' && argv[i + 1]) { args.outBase = argv[++i] ?? null; }
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp(): void {
  console.log(`kpi-compute — sf-extract出力にKPI計算・集計を適用

Usage:
  npm run compute -- --in PATH [--out-dir DIR] [--out-base NAME]

Options:
  --in / -i PATH       sf-extractの出力JSONパス（必須）
  --out-dir DIR        出力ディレクトリ（デフォルト: ./output）
  --out-base NAME      出力ファイル名のベース（拡張子なし、デフォルト: タイムスタンプ）
  --help / -h          このヘルプ

出力（4ファイル）:
  - {base}_deals.json     各案件にKPI計算結果を付与したJSON
  - {base}_summary.json   メンバー別・チーム別・月別の集計
  - {base}_issues.json    要修正案件一覧
  - {base}_ranking.txt    個人・チームランキングのテキスト表示
`);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inPath) {
    console.error('[kpi-compute] エラー: --in <PATH> でsf-extractの出力JSONを指定してください。');
    printHelp();
    process.exit(1);
  }

  console.log('[kpi-compute] 設定読込');
  const settings = loadKpiSettings();
  console.log('[kpi-compute]   メイン: ' + settings.msPoints.main + 'pt / サブ: ' + settings.msPoints.sub + 'pt');
  console.log('[kpi-compute]   時間当たり係数:');
  for (const t of settings.hourlyCoefThresholds) {
    console.log('               ' + (t.min + '円以上').padEnd(10) + ' → x' + t.coef.toFixed(1));
  }

  console.log('[kpi-compute] 入力読込: ' + args.inPath);
  const sf = loadDealsJson(args.inPath);
  console.log('[kpi-compute]   案件数: ' + sf.deals.length + '件');

  console.log('[kpi-compute] KPI計算実行...');
  const dealsWithPoint = computeAllDeals(sf.deals, settings);

  console.log('[kpi-compute] 集計実行...');
  const agg = aggregate(dealsWithPoint);
  const aggByMonth = aggregateByMonth(dealsWithPoint);
  const aggByFy = aggregateByFiscalYear(dealsWithPoint);
  const monthKeys = Object.keys(aggByMonth).sort();
  const fyKeys = Object.keys(aggByFy).sort();
  console.log('[kpi-compute]   月別集計: ' + monthKeys.join(', '));
  console.log('[kpi-compute]   年度別: ' + fyKeys.join(', '));

  console.log('');
  console.log('[kpi-compute] === 集計結果 ===');
  console.log('  全体合計ポイント: ' + agg.totalPoint.toFixed(2) + 'pt');
  console.log('  全体案件数      : ' + agg.totalDeals + '件');
  console.log('  要修正案件      : ' + agg.totalIssues + '件');

  console.log('');
  console.log('[kpi-compute] === チームランキング ===');
  for (const t of agg.rankings.team) {
    console.log('  ' + t.rank + '. ' + t.teamId + ': ' + t.point.toFixed(2) + 'pt');
  }

  console.log('');
  console.log('[kpi-compute] === 個人ランキング TOP10 ===');
  for (const r of agg.rankings.individual.slice(0, 10)) {
    console.log('  ' + String(r.rank).padStart(2) + '. ' + r.teamId + ' ' + r.ownerName.padEnd(12) + ' ' + r.point.toFixed(2).padStart(7) + 'pt  (' + r.deals + '件)');
  }

  console.log('');
  console.log('[kpi-compute] === 月別合計 ===');
  for (const m of agg.monthly) {
    const teamBreakdown = Object.entries(m.byTeam).sort().map(([t, p]) => t + ':' + p.toFixed(1)).join(', ');
    console.log('  ' + m.yearMonth + ': ' + m.totalPoint.toFixed(2) + 'pt (' + m.totalDeals + '件) [' + teamBreakdown + ']');
  }

  // 出力
  fs.mkdirSync(args.outDir, { recursive: true });
  const base = args.outBase ?? ('compute-' + timestamp());
  const dealsPath = path.join(args.outDir, base + '_deals.json');
  const summaryPath = path.join(args.outDir, base + '_summary.json');
  const issuesPath = path.join(args.outDir, base + '_issues.json');

  fs.writeFileSync(dealsPath, JSON.stringify({
    sourceFile: args.inPath,
    sourceExportedAt: sf.exportedAt,
    settings,
    deals: dealsWithPoint,
  }, null, 2), 'utf-8');

  fs.writeFileSync(summaryPath, JSON.stringify({
    computedAt: new Date().toISOString(),
    sourceFile: args.inPath,
    settings,
    aggregate: agg,
    aggregateByPeriod: aggByMonth,
    aggregateByFiscalYear: aggByFy,
  }, null, 2), 'utf-8');

  const issues = dealsWithPoint.filter(d => d.hasIssue).map(d => ({
    id: d.id,
    name: d.name,
    ownerName: d.ownerName,
    teamId: d.teamId,
    issues: d.issues,
    monthlyRevenue: d.monthlyRevenue,
    monthlyWorkdays: d.monthlyWorkdays,
    dailyHours: d.dailyHours,
    hourlyRate: d.hourlyRate,
    msKbn: d.msKbn,
    msKbnRaw: d.msKbnRaw,
  }));
  fs.writeFileSync(issuesPath, JSON.stringify({
    totalIssues: issues.length,
    deals: issues,
  }, null, 2), 'utf-8');

  console.log('');
  console.log('[kpi-compute] 出力:');
  console.log('  ' + dealsPath);
  console.log('  ' + summaryPath);
  console.log('  ' + issuesPath);
}

main().catch(err => {
  console.error('[kpi-compute] エラー:', err instanceof Error ? err.message : err);
  process.exit(1);
});
