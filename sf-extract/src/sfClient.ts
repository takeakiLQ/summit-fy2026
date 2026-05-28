/**
 * Salesforce REST API クライアント
 *
 * トークンを保持してSOQL/REST呼び出しを行う薄いラッパー。
 * 読み取り専用（query系のみ）。
 */
import { env, debug } from './config.js';
import type { SalesforceToken } from './auth.js';

export interface QueryResponse<T = Record<string, unknown>> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export class SalesforceClient {
  constructor(private readonly token: SalesforceToken) {}

  /** API バージョンのベースパス */
  private apiBase(): string {
    return `${this.token.instanceUrl.replace(/\/+$/, '')}/services/data/${env.SF_API_VERSION}`;
  }

  /** SOQL クエリを実行 */
  async query<T = Record<string, unknown>>(soql: string): Promise<QueryResponse<T>> {
    const url = `${this.apiBase()}/query?q=${encodeURIComponent(soql)}`;
    return this.callJson<QueryResponse<T>>(url);
  }

  /** ページング: nextRecordsUrl の続きを取得 */
  async queryMore<T = Record<string, unknown>>(nextRecordsUrl: string): Promise<QueryResponse<T>> {
    const url = `${this.token.instanceUrl.replace(/\/+$/, '')}${nextRecordsUrl}`;
    return this.callJson<QueryResponse<T>>(url);
  }

  /** SOQL クエリを実行して全ページを集約 */
  async queryAll<T = Record<string, unknown>>(soql: string): Promise<T[]> {
    const all: T[] = [];
    let res = await this.query<T>(soql);
    all.push(...res.records);
    while (!res.done && res.nextRecordsUrl) {
      debug('queryMore', res.nextRecordsUrl);
      res = await this.queryMore<T>(res.nextRecordsUrl);
      all.push(...res.records);
    }
    return all;
  }

  /** オブジェクトのメタデータ（describe）を取得 */
  async describe(objectApiName: string): Promise<Record<string, unknown>> {
    const url = `${this.apiBase()}/sobjects/${encodeURIComponent(objectApiName)}/describe`;
    return this.callJson<Record<string, unknown>>(url);
  }

  /** 認証ヘッダ付きで GET し、JSONを返す */
  private async callJson<T>(url: string): Promise<T> {
    debug('GET', url);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `${this.token.tokenType} ${this.token.accessToken}`,
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Salesforce API 失敗 (HTTP ${res.status}): ${text.slice(0, 1000)}`
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Salesforce API がJSONを返しませんでした: ${text.slice(0, 500)}`);
    }
  }
}
