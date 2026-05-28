#!/usr/bin/env node
/**
 * sync-data.js: kpi-compute と csv-import の最新出力を data.js に統合
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname);

function latestFile(dir, suffix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(suffix))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(dir, files[0].name) : null;
}

function parseArgs() {
  const args = { summary: null, deals: null, financials: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--summary' || a === '-s') && argv[i + 1]) args.summary = argv[++i];
    else if ((a === '--deals') && argv[i + 1]) args.deals = argv[++i];
    else if ((a === '--import' || a === '-i') && argv[i + 1]) args.financials = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs();
  const kpiOut = path.resolve(projectRoot, '..', 'kpi-compute', 'output');
  const csvOut = path.resolve(projectRoot, '..', 'csv-import', 'output');

  const summaryPath = args.summary || latestFile(kpiOut, '_summary.json');
  const dealsPath = args.deals || latestFile(kpiOut, '_deals.json');
  const finPath = args.financials || latestFile(csvOut, '.json');

  if (!summaryPath) { console.error('summary.json なし'); process.exit(1); }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const deals = dealsPath ? JSON.parse(fs.readFileSync(dealsPath, 'utf-8')) : null;
  const financials = (finPath && fs.existsSync(finPath)) ? JSON.parse(fs.readFileSync(finPath, 'utf-8')) : null;

  const outPath = path.join(__dirname, 'data.js');
  const lines = [
    '// 自動生成: ' + new Date().toISOString(),
    '// summary    : ' + (summaryPath ? path.relative(__dirname, summaryPath) : '(none)'),
    '// deals      : ' + (dealsPath ? path.relative(__dirname, dealsPath) : '(none)'),
    '// financials : ' + (finPath ? path.relative(__dirname, finPath) : '(none)'),
    'window.__SUMMARY__ = ' + JSON.stringify(summary, null, 2) + ';',
    'window.__DEALS__ = ' + JSON.stringify(deals, null, 2) + ';',
    'window.__FINANCIALS__ = ' + JSON.stringify(financials, null, 2) + ';',
  ];
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
  console.log('data.js 更新');
  console.log('  summary    : ' + summaryPath);
  console.log('  deals      : ' + (dealsPath || '(none)'));
  console.log('  financials : ' + (finPath || '(none)'));
  console.log('  size       : ' + fs.statSync(outPath).size + ' bytes');
}
main();
