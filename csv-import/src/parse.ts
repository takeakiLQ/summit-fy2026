/**
 * CSVパース（UTF-8 BOM対応、ダブルクォート対応、簡易CSV）
 * 仕様: ヘッダ行ありの単純CSV。値はカンマ区切り、ダブルクォートでエスケープ可能。
 */
import fs from 'node:fs';
import type { CsvMappingConfig, RawCsvRow } from './types.js';

/** UTF-8 BOM (EF BB BF) を除去 */
function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xFEFF) return s.slice(1);
  return s;
}

/** 1行をCSV分割（"..."のクオート対応） */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') { inQuote = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

function parseNumber(v: string): number {
  if (!v) return NaN;
  const cleaned = v.trim().replace(/,/g, '').replace(/^"|"$/g, '');
  return Number(cleaned);
}

export interface ParsedCsv {
  rows: RawCsvRow[];
  errors: { line: number; message: string }[];
}

export function parseCsvFile(filePath: string, mapping: CsvMappingConfig): ParsedCsv {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const text = stripBom(raw);
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'CSVが空です' }] };
  }

  const header = splitCsvLine(lines[0]!);
  const cols = mapping.columns;

  // ヘッダ位置を特定
  const idx = {
    yearMonth: header.indexOf(cols.yearMonth),
    manualNo: header.indexOf(cols.manualNo),
    revenueTotal: header.indexOf(cols.revenueTotal),
    costTotal: header.indexOf(cols.costTotal),
    cpCostTotal: header.indexOf(cols.cpCostTotal),
    workdays: header.indexOf(cols.workdays),
  };

  const missing: string[] = [];
  for (const [k, v] of Object.entries(idx)) {
    if (v < 0) missing.push((cols as Record<string, string>)[k] + ' (' + k + ')');
  }
  if (missing.length > 0) {
    return { rows: [], errors: [{ line: 1, message: 'ヘッダに必須カラムが見つかりません: ' + missing.join(', ') }] };
  }

  const rows: RawCsvRow[] = [];
  const errors: { line: number; message: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1; // 1-based
    const cells = splitCsvLine(lines[i]!);
    const yearMonthRaw = (cells[idx.yearMonth] ?? '').trim();
    const manualNoRaw = (cells[idx.manualNo] ?? '').trim();
    const revenueTotal = parseNumber(cells[idx.revenueTotal] ?? '');
    const costTotal = parseNumber(cells[idx.costTotal] ?? '');
    const cpCostTotal = parseNumber(cells[idx.cpCostTotal] ?? '');
    const workdays = parseNumber(cells[idx.workdays] ?? '');

    if (!yearMonthRaw || !manualNoRaw) {
      errors.push({ line: lineNo, message: '配送年月またはマニュアル番号が空' });
      continue;
    }
    if (Number.isNaN(revenueTotal)) {
      errors.push({ line: lineNo, message: '売上合計が数値でない: ' + cells[idx.revenueTotal] });
      continue;
    }
    if (Number.isNaN(cpCostTotal)) {
      errors.push({ line: lineNo, message: 'CP用原価合計が数値でない: ' + cells[idx.cpCostTotal] });
      continue;
    }

    rows.push({
      yearMonthRaw,
      manualNoRaw,
      revenueTotal,
      costTotal: Number.isNaN(costTotal) ? 0 : costTotal,
      cpCostTotal,
      workdays: Number.isNaN(workdays) ? 0 : workdays,
      lineNumber: lineNo,
    });
  }

  return { rows, errors };
}

/** YYYYMM → YYYY-MM 形式に変換 */
export function normalizeYearMonth(s: string): string | null {
  const t = s.replace(/['"]/g, '').trim();
  if (/^\d{6}$/.test(t)) return t.slice(0, 4) + '-' + t.slice(4, 6);
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  return null;
}
