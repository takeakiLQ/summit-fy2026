/**
 * SOQL ビルダー
 * Oppotunities__c オブジェクトから対象案件を取得するクエリを組み立てる。
 *
 * フィルタ:
 *  - 担当者: PersoninCharge__r.Name IN (氏名) OR PersoninCharge__r.Email IN (メアド)
 *    どちらか一致で含める（表記揺れ救済）
 *  - Status, OpputunityClassification, Item は columns.json の filters から
 *  - OperationStartDate >= columns.json の operationStartFrom
 */
import type { ColumnsConfig } from './config.js';

export interface BuildQueryOptions {
  ownerNames?: string[];
  ownerEmails?: string[];
  modifiedSince?: string;
  orderBy?: string;
  limit?: number;
}

function escapeSoqlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function inClause(field: string, values: string[]): string {
  const escaped = values.map(v => "'" + escapeSoqlString(v) + "'").join(', ');
  return field + ' IN (' + escaped + ')';
}

export function buildDealQuery(cols: ColumnsConfig, opts: BuildQueryOptions = {}): string {
  const f = cols.fields;

  const selectFields = [
    f.id, f.name, f.manualNo, f.ownerName, f.ownerEmail,
    f.msKbn, f.monthlyRevenue, f.contractPrice,
    f.monthlyWorkdays, f.dailyHours,
    f.status, f.classification,
    f.operationStartDate, f.plannedStartDate,
    f.registeredAt, f.lastModifiedAt,
    f.groupFy22,
  ].filter(x => x && x.trim() !== '');

  const uniqueFields = Array.from(new Set(selectFields));

  const wheres: string[] = [];

  // 担当者フィルタ: 氏名 OR メアド
  const ownerClauses: string[] = [];
  if (opts.ownerNames && opts.ownerNames.length > 0 && f.ownerName) {
    ownerClauses.push(inClause(f.ownerName, opts.ownerNames));
  }
  if (opts.ownerEmails && opts.ownerEmails.length > 0 && f.ownerEmail) {
    ownerClauses.push(inClause(f.ownerEmail, opts.ownerEmails));
  }
  if (ownerClauses.length === 1) {
    wheres.push(ownerClauses[0]!);
  } else if (ownerClauses.length > 1) {
    wheres.push('(' + ownerClauses.join(' OR ') + ')');
  }

  // ステータス
  if (cols.filters?.statusInclude && cols.filters.statusInclude.length > 0) {
    wheres.push(inClause(f.status, cols.filters.statusInclude));
  }

  // 案件区分
  if (cols.filters?.classificationInclude && cols.filters.classificationInclude.length > 0) {
    wheres.push(inClause(f.classification, cols.filters.classificationInclude));
  }

  // MS区分
  if (cols.filters?.msKbnInclude && cols.filters.msKbnInclude.length > 0) {
    wheres.push(inClause(f.msKbn, cols.filters.msKbnInclude));
  }

  // 稼働開始日（YYYY-MM-DD形式）
  if (cols.filters?.operationStartFrom && cols.filters.operationStartFrom.trim() !== '' && f.operationStartDate) {
    wheres.push(f.operationStartDate + ' >= ' + cols.filters.operationStartFrom);
  }

  // 差分同期（任意）
  if (opts.modifiedSince) {
    wheres.push(f.lastModifiedAt + ' > ' + opts.modifiedSince);
  }

  const whereClause = wheres.length > 0 ? ' WHERE ' + wheres.join(' AND ') : '';
  const orderBy = opts.orderBy ?? (f.lastModifiedAt + ' DESC');
  const limitClause = opts.limit ? ' LIMIT ' + opts.limit : '';

  return 'SELECT ' + uniqueFields.join(', ') + ' FROM ' + cols.objectApiName + whereClause + ' ORDER BY ' + orderBy + limitClause;
}
