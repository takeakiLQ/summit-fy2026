/**
 * Firestore Admin SDK 初期化と書き込みユーティリティ
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');

function findServiceAccountKey(): string | null {
  const standard = path.join(projectRoot, 'service-account.json');
  if (fs.existsSync(standard)) return standard;
  const candidates = fs.readdirSync(projectRoot).filter(f =>
    f.startsWith('firebase-adminsdk-') ||
    f === 'service-account.json.json' ||
    /\.serviceaccount\.json$/.test(f)
  );
  if (candidates.length >= 1) return path.join(projectRoot, candidates[0]!);
  return null;
}

const keyPath = findServiceAccountKey();
if (!keyPath) {
  console.error('エラー: サービスアカウント鍵が見つかりません');
  console.error('期待パス: ' + path.join(projectRoot, 'service-account.json'));
  console.error('Firebase Console → プロジェクト設定 → サービスアカウント → 新しい秘密鍵を生成');
  process.exit(1);
}
console.log('[firestore-sync] 鍵ファイル: ' + path.basename(keyPath));

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
initializeApp({ credential: cert(serviceAccount) });
export const db: Firestore = getFirestore();
export { FieldValue };

/**
 * バッチ書き込みヘルパー（500件ごとにcommit）
 */
export async function batchSet(
  collection: string,
  items: { id: string; data: Record<string, unknown> }[],
  options: { merge?: boolean } = {}
): Promise<void> {
  const BATCH_LIMIT = 500;
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const slice = items.slice(i, i + BATCH_LIMIT);
    for (const { id, data } of slice) {
      const ref = db.collection(collection).doc(id);
      if (options.merge) batch.set(ref, data, { merge: true });
      else batch.set(ref, data);
    }
    await batch.commit();
    console.log('  ' + collection + ': ' + Math.min(i + BATCH_LIMIT, items.length) + '/' + items.length + ' 件書込');
  }
}

/**
 * コレクション全削除（小規模用）
 */
export async function deleteAll(collection: string): Promise<number> {
  const snap = await db.collection(collection).get();
  if (snap.size === 0) return 0;
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    const slice = docs.slice(i, i + 500);
    for (const d of slice) batch.delete(d.ref);
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
}

/**
 * 条件削除（指定フィールドの値で）
 */
export async function deleteWhere(
  collection: string,
  field: string,
  value: string | number
): Promise<number> {
  const snap = await db.collection(collection).where(field, '==', value).get();
  if (snap.size === 0) return 0;
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    const slice = docs.slice(i, i + 500);
    for (const d of slice) batch.delete(d.ref);
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
}
