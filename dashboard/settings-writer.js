/**
 * 設定画面（管理者用UI）のFirestore書込API
 * window.__SETTINGS_WRITER__ にエクスポートし、index.html の inline script から呼ぶ
 */
import {
  getFirestore, doc, setDoc, deleteDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';

function db() { return getFirestore(getApp()); }

async function upsertTeam(id, data) {
  // 既存ドキュメントに対する部分更新
  await setDoc(doc(db(), 'teams', id), {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function addTeam(id, name, color, sortOrder) {
  await setDoc(doc(db(), 'teams', id), {
    id, name, color,
    sortOrder: sortOrder ?? Date.now(),
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function deleteTeam(id) {
  await deleteDoc(doc(db(), 'teams', id));
}

async function upsertMember(email, data) {
  await setDoc(doc(db(), 'members', email), {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function addMember(name, email, team, role) {
  await setDoc(doc(db(), 'members', email), {
    name, email, team,
    role: role || 'member',
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function deleteMember(email) {
  await deleteDoc(doc(db(), 'members', email));
}

window.__SETTINGS_WRITER__ = {
  upsertTeam, addTeam, deleteTeam,
  upsertMember, addMember, deleteMember,
};
