import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KpiSettings, SfExtractResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');

export function loadKpiSettings(): KpiSettings {
  const fullPath = path.join(projectRoot, 'config/kpi-settings.json');
  const raw = fs.readFileSync(fullPath, 'utf-8');
  const cfg = JSON.parse(raw) as KpiSettings;
  // 閾値を降順に並び替え（高→低の順で評価）
  cfg.hourlyCoefThresholds = [...cfg.hourlyCoefThresholds].sort((a, b) => b.min - a.min);
  return cfg;
}

export function loadDealsJson(filePath: string): SfExtractResult {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw) as SfExtractResult;
}
