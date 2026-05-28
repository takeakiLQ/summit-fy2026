#!/usr/bin/env node
/**
 * csv-import CLI - 複数CSV一括処理対応版
 * ファイル名 Q配_CP用売上実績_YYYYMM.csv から年月を自動判定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvFile, normalizeYearMonth } from './parse.js';
import type {
  CsvMappingConfig,
  ImportResult,
  MonthlyRevenue,
  MatchedRevenue,
  SfExtractResult,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

interface CliArgs {
  csvPath: string | null;     // 単一CSVまたはフォルダ
  dealsPath: string | null;
  outBase: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { csvPath: null, dealsPath: null, outBase: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--csv' || a === '-c') && argv[i + 1]) { args.csvPath = argv[++i] ?? null; }
    else if ((a === '--deals' || a === '-d') && argv[i + 1]) { args.dealsPath = argv[++i] ?? null; }
    else if ((a === '--out-base' || a === '-o') && argv[i + 1]) { args.outBase = argv[++i] ?? null; }
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp(): void {
  console.log(`csv-import — 月別売上・粗利CSVを取り込み、sf-extract dealsとマニュアル番号で突合

Usage:
  npm run import -- --csv <CSV_PATH_OR_FOLDER> [--deals <DEALS_JSON>]

Options:
  --csv / -c PATH    CSVファイル単体、またはフォルダ（フォルダ内の全CSVを処理）
  --deals / -d PATH  sf-extract出力JSON（省略時は最新を自動検出）
  --out-base NAME    出力ベース名（省略時はタイムスタンプ）

CSV仕様: 配送年月,マニュアル番号,売上合計,原価合計,CP用原価合計,稼働日数
ファイル名から年月自動判定: 例) Q配_CP用売上実績_202504.csv → 2025-04
`);
}

function findLatestDeals(): string | null {
  const dir = path.resolve(projectRoot, '..', 'sf-extract', 'output');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('deals-') && f.endsWith('.json'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(dir, files[0].name) : null;
}

function loadMapping(): CsvMappingConfig {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'config', 'csv-mapping.json'), 'utf-8')) as CsvMappingConfig;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/** ファイル名から YYYYMM パターンを抽出 → YYYY-MM */
function ymFromFilename(filename: string): string | null {
  const m = filename.match(/(\d{6})/);
  if (!m) return null;
  const ym = m[1]!;
  const y = ym.slice(0, 4);
  const mo = ym.slice(4, 6);
  if (Number(mo) < 1 || Number(mo) > 12) return null;
  return y + '-' + mo;
}

/** CSVパスがフォルダか単一ファイルかを判定して、処理対象のCSVファイル一覧を返す */
function collectCsvFiles(p: string): string[] {
  if (!fs.existsSync(p)) throw new Error('パスが存在しません: ' + p);
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    return fs.readdirSync(p)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .map(f => path.join(p, f))
      .sort();
  }
  return [p];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csvPath) {
    console.error('[csv-import] エラー: --csv で取込対象（ファイルまたはフォルダ）を指定してください。');
    printHelp();
    process.exit(1);
  }
  const dealsPath = args.dealsPath ?? findLatestDeals();
  if (!dealsPath) {
    console.error('[csv-import] エラー: --deals でsf-extractのJSONを指定してください。');
    process.exit(1);
  }

  const mapping = loadMapping();
  const csvFiles = collectCsvFiles(args.csvPath);
  console.log('[csv-import] 取込対象CSV: ' + csvFiles.length + '件');
  for (const f of csvFiles) console.log('  ' + path.basename(f));

  // 全CSVをパース＆統合
  const allRevenues: MonthlyRevenue[] = [];
  const allParseErrors: { file: string; line: number; message: string }[] = [];
  for (const csvFile of csvFiles) {
    const ymFromName = ymFromFilename(path.basename(csvFile));
    const parsed = parseCsvFile(csvFile, mapping);
    for (const e of parsed.errors) allParseErrors.push({ file: path.basename(csvFile), line: e.line, message: e.message });
    for (const r of parsed.rows) {
      const ymFromRow = normalizeYearMonth(r.yearMonthRaw);
      const ym = ymFromRow ?? ymFromName;  // 行内優先、なければファイル名から
      if (!ym) continue;
      allRevenues.push({
        yearMonth: ym,
        manualNo: r.manualNoRaw,
        revenue: r.revenueTotal,
        grossProfit: r.revenueTotal - r.cpCostTotal,
        workdays: r.workdays,
      });
    }
  }
  console.log('[csv-import] 合計行数: ' + allRevenues.length + ' / パースエラー: ' + allParseErrors.length);

  // deals 読込
  const dealsJson = JSON.parse(fs.readFileSync(dealsPath, 'utf-8')) as SfExtractResult;
  console.log('[csv-import] deals件数: ' + dealsJson.deals.length);

  const manualToDeal = new Map<string, SfExtractResult['deals'][number]>();
  for (const d of dealsJson.deals) {
    if (d.manualNo != null && d.manualNo !== '') {
      manualToDeal.set(String(d.manualNo).trim(), d);
    }
  }

  // 突合
  const matchedRows: MatchedRevenue[] = [];
  const unmatchedManualNos = new Set<string>();
  const matchedManuals = new Set<string>();

  for (const r of allRevenues) {
    const key = r.manualNo.replace(/['"]/g, '').trim();
    const d = manualToDeal.get(key);
    if (d) {
      matchedRows.push({
        ...r,
        dealId: d.id, dealName: d.name,
        ownerName: d.ownerName, teamId: d.teamId,
        matched: true,
      });
      matchedManuals.add(key);
    } else {
      unmatchedManualNos.add(key);
    }
  }

  const unmatchedDeals: ImportResult['unmatchedDeals'] = [];
  for (const d of dealsJson.deals) {
    if (d.manualNo != null && d.manualNo !== '' && !matchedManuals.has(String(d.manualNo).trim())) {
      unmatchedDeals.push({ manualNo: d.manualNo, dealId: d.id, name: d.name, ownerName: d.ownerName, teamId: d.teamId });
    }
  }

  // 集計
  const totals = {
    revenue: 0,
    grossProfit: 0,
    byTeam: {} as Record<string, { revenue: number; grossProfit: number; deals: number }>,
    byMember: {} as Record<string, { ownerName: string; teamId: string; revenue: number; grossProfit: number; deals: number }>,
    byMonth: {} as Record<string, { revenue: number; grossProfit: number; deals: number; byTeam: Record<string, { revenue: number; grossProfit: number }> }>,
  };
  for (const r of matchedRows) {
    totals.revenue += r.revenue;
    totals.grossProfit += r.grossProfit;
    const team = r.teamId ?? '?';
    if (!totals.byTeam[team]) totals.byTeam[team] = { revenue: 0, grossProfit: 0, deals: 0 };
    totals.byTeam[team].revenue += r.revenue;
    totals.byTeam[team].grossProfit += r.grossProfit;
    totals.byTeam[team].deals++;
    const memKey = (r.ownerName ?? '?') + '|' + team;
    if (!totals.byMember[memKey]) totals.byMember[memKey] = { ownerName: r.ownerName ?? '?', teamId: team, revenue: 0, grossProfit: 0, deals: 0 };
    totals.byMember[memKey].revenue += r.revenue;
    totals.byMember[memKey].grossProfit += r.grossProfit;
    totals.byMember[memKey].deals++;
    if (!totals.byMonth[r.yearMonth]) totals.byMonth[r.yearMonth] = { revenue: 0, grossProfit: 0, deals: 0, byTeam: {} };
    const mm = totals.byMonth[r.yearMonth]!;
    mm.revenue += r.revenue;
    mm.grossProfit += r.grossProfit;
    mm.deals++;
    if (!mm.byTeam[team]) mm.byTeam[team] = { revenue: 0, grossProfit: 0 };
    const mmt = mm.byTeam[team]!;
    mmt.revenue += r.revenue;
    mmt.grossProfit += r.grossProfit;
  }

  const result = {
    importedAt: new Date().toISOString(),
    sourceFiles: csvFiles.map(f => path.basename(f)),
    totalRows: allRevenues.length,
    parseErrors: allParseErrors,
    matched: matchedRows.length,
    unmatched: unmatchedManualNos.size,
    matchedRows,
    unmatchedManualNos: Array.from(unmatchedManualNos),
    unmatchedDeals,
    totals,
  };

  console.log('');
  console.log('[csv-import] === 結果 ===');
  console.log('  突合: ' + matchedRows.length + '件 / 未突合: ' + unmatchedManualNos.size + 'マニュアル');
  console.log('  合計売上: ¥' + Math.round(totals.revenue).toLocaleString());
  console.log('  合計粗利: ¥' + Math.round(totals.grossProfit).toLocaleString());
  console.log('');
  console.log('[csv-import] === 月別 ===');
  for (const [ym, m] of Object.entries(totals.byMonth).sort()) {
    console.log('  ' + ym + ': 売上 ¥' + Math.round(m.revenue).toLocaleString().padStart(12) + ' / 粗利 ¥' + Math.round(m.grossProfit).toLocaleString().padStart(11) + ' / ' + m.deals + '件');
  }
  console.log('');
  console.log('[csv-import] === チーム別 ===');
  for (const [team, t] of Object.entries(totals.byTeam).sort()) {
    console.log('  ' + team + ': 売上 ¥' + Math.round(t.revenue).toLocaleString().padStart(12) + ' / 粗利 ¥' + Math.round(t.grossProfit).toLocaleString().padStart(11) + ' / ' + t.deals + '件');
  }

  const outDir = path.join(projectRoot, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const base = args.outBase ?? ('import-' + timestamp());
  const outPath = path.join(outDir, base + '.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log('');
  console.log('[csv-import] 出力: ' + outPath);
}

main().catch(err => {
  console.error('[csv-import] エラー:', err instanceof Error ? err.message : err);
  process.exit(1);
});
