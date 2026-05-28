#!/usr/bin/env node
/**
 * ローカルの csv-import の出力 (monthly_revenue) を Cloudflare D1 に投入
 *
 * 使い方:
 *   node import-financials.mjs <baseUrl> <SYNC_API_KEY> <financials.json path>
 *
 * 例:
 *   node import-financials.mjs https://summit-fy2026.pages.dev YOUR_API_KEY ../../csv-import/output/fy2025.json
 */
import fs from 'node:fs';

const [, , baseUrl, apiKey, jsonPath] = process.argv;
if (!baseUrl || !apiKey || !jsonPath) {
  console.error('Usage: node import-financials.mjs <baseUrl> <SYNC_API_KEY> <financials.json path>');
  process.exit(1);
}

if (!fs.existsSync(jsonPath)) {
  console.error('File not found:', jsonPath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const rows = (data.matchedRows || []).map(r => ({
  yearMonth: r.yearMonth,
  dealId: r.dealId,
  manualNo: r.manualNo,
  ownerName: r.ownerName,
  teamId: r.teamId,
  revenue: r.revenue || 0,
  grossProfit: r.grossProfit || 0,
  workdays: r.workdays || 0,
}));

console.log('Financial rows to import:', rows.length);
console.log('Estimated payload size:', (JSON.stringify({ rows }).length / 1024 / 1024).toFixed(2), 'MB');

const start = Date.now();
const res = await fetch(baseUrl + '/api/sync/financials', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sync-api-key': apiKey },
  body: JSON.stringify({
    rows,
    uploadedBy: 'github-import',
    sourceFile: jsonPath.split(/[\\/]/).pop(),
  }),
});

const text = await res.text();
let result;
try { result = JSON.parse(text); } catch { result = text; }

console.log('Status:', res.status, '(', ((Date.now() - start) / 1000).toFixed(1), 's)');
console.log('Response:', typeof result === 'string' ? result : JSON.stringify(result, null, 2));
process.exit(res.ok ? 0 : 1);
