#!/usr/bin/env node
/**
 * ローカルの kpi-compute の出力 (deals.json) を Cloudflare D1 に投入
 *
 * 使い方:
 *   node import-deals.mjs <baseUrl> <SYNC_API_KEY> <deals.json path>
 *
 * 例:
 *   node import-deals.mjs https://summit-fy2026.pages.dev YOUR_API_KEY ../../kpi-compute/output/fy2025_deals.json
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , baseUrl, apiKey, jsonPath] = process.argv;
if (!baseUrl || !apiKey || !jsonPath) {
  console.error('Usage: node import-deals.mjs <baseUrl> <SYNC_API_KEY> <deals.json path>');
  process.exit(1);
}

if (!fs.existsSync(jsonPath)) {
  console.error('File not found:', jsonPath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const deals = (data.deals || []).map((d) => {
  // 重い `raw` フィールドを除外
  const { raw, ...rest } = d;
  return rest;
});
console.log('Deals to import:', deals.length);
console.log('Estimated payload size:', (JSON.stringify({ deals }).length / 1024 / 1024).toFixed(2), 'MB');

const start = Date.now();
const res = await fetch(baseUrl + '/api/sync/deals', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sync-api-key': apiKey },
  body: JSON.stringify({ deals }),
});

const text = await res.text();
let result;
try { result = JSON.parse(text); } catch { result = text; }

console.log('Status:', res.status, '(', ((Date.now() - start) / 1000).toFixed(1), 's)');
console.log('Response:', typeof result === 'string' ? result : JSON.stringify(result, null, 2));
process.exit(res.ok ? 0 : 1);
