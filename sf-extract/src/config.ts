/**
 * 環境変数および設定ファイルのロード
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    throw new Error('環境変数 ' + key + ' が設定されていません。.env ファイルを確認してください。');
  }
  return v.trim();
}

function optionalEnv(key: string, defaultValue = ''): string {
  return (process.env[key] ?? defaultValue).trim();
}

export const env = {
  get SF_AUTH_TYPE() { return optionalEnv('SF_AUTH_TYPE', 'username_password').toLowerCase(); },
  get SF_LOGIN_URL() { return optionalEnv('SF_LOGIN_URL', 'https://login.salesforce.com'); },
  get SF_INSTANCE_URL() { return optionalEnv('SF_INSTANCE_URL'); },
  get SF_CLIENT_ID() { return requireEnv('SF_CLIENT_ID'); },
  get SF_CLIENT_SECRET() { return requireEnv('SF_CLIENT_SECRET'); },
  get SF_USERNAME() { return requireEnv('SF_USERNAME'); },
  get SF_PASSWORD() { return requireEnv('SF_PASSWORD'); },
  get SF_SECURITY_TOKEN() { return requireEnv('SF_SECURITY_TOKEN'); },
  get SF_API_VERSION() { return optionalEnv('SF_API_VERSION', 'v60.0'); },
  get DEAL_OBJECT_API_NAME() { return optionalEnv('DEAL_OBJECT_API_NAME', ''); },
  get OUTPUT_DIR() { return optionalEnv('OUTPUT_DIR', './output'); },
  get DEBUG() { return optionalEnv('DEBUG', 'false').toLowerCase() === 'true'; },
};

export interface ColumnsConfig {
  objectApiName: string;
  fields: {
    id: string;
    name: string;
    manualNo: string;
    ownerName: string;
    ownerEmail: string;
    msKbn: string;
    monthlyRevenue: string;
    contractPrice: string;
    monthlyWorkdays: string;
    dailyHours: string;
    status: string;
    classification: string;
    operationStartDate: string;
    plannedStartDate: string;
    registeredAt: string;
    lastModifiedAt: string;
    groupFy22?: string;
  };
  filters: {
    statusInclude: string[];
    classificationInclude: string[];
    msKbnInclude?: string[];
    operationStartFrom?: string;
  };
  $msKbnValues?: {
    main: string;
    sub: string;
  };
}

export interface MembersConfig {
  teams: { id: string; name: string; color: string }[];
  members: { team: string; name: string; email: string }[];
}

function loadJson<T>(relativePath: string): T {
  const fullPath = path.join(projectRoot, relativePath);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(raw) as T;
}

export function loadColumns(): ColumnsConfig {
  const cfg = loadJson<ColumnsConfig>('config/columns.json');
  if (env.DEAL_OBJECT_API_NAME) cfg.objectApiName = env.DEAL_OBJECT_API_NAME;
  return cfg;
}

export function loadMembers(): MembersConfig {
  return loadJson<MembersConfig>('config/members.json');
}

export const paths = {
  projectRoot,
  get outputDir() { return path.resolve(projectRoot, env.OUTPUT_DIR); },
};

export function debug(...args: unknown[]): void {
  if (env.DEBUG) console.error('[DEBUG]', ...args);
}
