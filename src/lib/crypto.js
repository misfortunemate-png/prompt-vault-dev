// vault鍵管理と AES-256-GCM 暗号化・復号
// localStorage 'pv-vault-key' → { id: 'vault:v1', raw: '<base64>' }

import { recordInvalid, describeSecret } from './invalidLog.js';

const LS_KEY = 'pv-vault-key';
const KEY_BYTES = 32; // AES-256

export function hasVaultKey() {
  try {
    return !!localStorage.getItem(LS_KEY);
  } catch { return false; }
}

// F-12: 記録が解析できない・形が違うときは「未設定」に寄せず、集約先に残す（鍵の値は残さない・J-3）
function loadKeyRecord() {
  let v;
  try {
    v = localStorage.getItem(LS_KEY);
  } catch (e) {
    recordInvalid({ kind: 'vault-key-storage-unavailable', stage: 'F-12 crypto.loadKeyRecord', raw: e?.message ?? String(e), reason: 'localStorage が読めない' });
    return null;
  }
  if (!v) return null;
  let rec;
  try {
    rec = JSON.parse(v);
  } catch (e) {
    recordInvalid({ kind: 'vault-key-record-unparseable', stage: 'F-12 crypto.loadKeyRecord', raw: describeSecret(v), reason: `JSON として解析できない: ${e.message}` });
    return null;
  }
  if (!rec || typeof rec.id !== 'string' || typeof rec.raw !== 'string') {
    recordInvalid({ kind: 'vault-key-record-invalid', stage: 'F-12 crypto.loadKeyRecord', raw: `id=${JSON.stringify(rec?.id)} raw=${describeSecret(rec?.raw)}`, reason: 'id・raw が文字列でない' });
    return null;
  }
  return rec;
}

// 当たる枝: base64（パディング込み）で、復号すると 32 バイトになるもの
function keyProblem(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return 'base64 でない';
  let bytes;
  try { bytes = atob(value); } catch { return 'base64 として復号できない'; }
  if (bytes.length !== KEY_BYTES) return `長さが 256bit（${KEY_BYTES} バイト）でない（${bytes.length} バイト）`;
  return null;
}

export async function getVaultKey() {
  const rec = loadKeyRecord();
  if (!rec) return null;
  const bytes = Uint8Array.from(atob(rec.raw), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// F-12・J-8: 当たらない鍵は保存しない
export function setVaultKey(base64Raw) {
  const value = typeof base64Raw === 'string' ? base64Raw.trim() : base64Raw;
  const problem = keyProblem(value);
  if (problem) {
    recordInvalid({ kind: 'vault-key-import-invalid', stage: 'F-12 crypto.setVaultKey', raw: describeSecret(value), reason: problem });
    throw new Error(`vault鍵として使えません: ${problem}`);
  }
  localStorage.setItem(LS_KEY, JSON.stringify({ id: 'vault:v1', raw: value }));
}

export function clearVaultKey() {
  localStorage.removeItem(LS_KEY);
}

export async function generateVaultKey() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  const bytes = new Uint8Array(raw);
  const base64 = btoa(String.fromCharCode(...bytes));
  setVaultKey(base64);
  return { id: 'vault:v1', raw: base64 };
}

// 暗号文フォーマット: [1byte: key_id長][key_id UTF-8][12bytes: IV][残り: ciphertext+tag]
export async function encrypt(plainBuffer) {
  const key = await getVaultKey();
  if (!key) throw new Error('vault鍵が設定されていません');
  const rec = loadKeyRecord();
  const idBytes = new TextEncoder().encode(rec.id);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBuffer);
  const idLen = idBytes.length;
  const result = new Uint8Array(1 + idLen + 12 + ciphertext.byteLength);
  result[0] = idLen;
  result.set(idBytes, 1);
  result.set(iv, 1 + idLen);
  result.set(new Uint8Array(ciphertext), 1 + idLen + 12);
  return result;
}

export async function decrypt(encryptedBuffer) {
  const key = await getVaultKey();
  if (!key) throw new Error('vault鍵が設定されていません');
  const buf = encryptedBuffer instanceof Uint8Array ? encryptedBuffer : new Uint8Array(encryptedBuffer);
  const idLen = buf[0];
  if (buf.length < 1 + idLen + 12 + 16) {
    recordInvalid({ kind: 'ciphertext-malformed', stage: 'F-12 crypto.decrypt', raw: `length=${buf.length} idLen=${idLen}`, reason: '暗号文が形式（[idLen][keyId][IV12][本文+tag16]）より短い' });
    throw new Error('暗号文の形式が不正です');
  }
  // J-8: 暗号文の keyId が手元の鍵と違えば記録する（鍵の世代の振り分けはしない。復号は試みる）
  const keyId = new TextDecoder().decode(buf.slice(1, 1 + idLen));
  const rec = loadKeyRecord();
  if (rec && keyId !== rec.id) {
    recordInvalid({ kind: 'vault-key-id-mismatch', stage: 'F-12 crypto.decrypt', raw: `ciphertext keyId=${JSON.stringify(keyId)} local keyId=${JSON.stringify(rec.id)}`, reason: '暗号文の鍵 id が手元の鍵と違う（復号は試みる）' });
  }
  const iv = buf.slice(1 + idLen, 1 + idLen + 12);
  const ciphertext = buf.slice(1 + idLen + 12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}
