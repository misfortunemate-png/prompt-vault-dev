// vault鍵管理と AES-256-GCM 暗号化・復号
// localStorage 'pv-vault-key' → { id: 'vault:v1', raw: '<base64>' }

const LS_KEY = 'pv-vault-key';

export function hasVaultKey() {
  try {
    return !!localStorage.getItem(LS_KEY);
  } catch { return false; }
}

function loadKeyRecord() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (!v) return null;
    return JSON.parse(v);
  } catch { return null; }
}

export async function getVaultKey() {
  const rec = loadKeyRecord();
  if (!rec) return null;
  const bytes = Uint8Array.from(atob(rec.raw), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function setVaultKey(base64Raw) {
  localStorage.setItem(LS_KEY, JSON.stringify({ id: 'vault:v1', raw: base64Raw }));
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
  const iv = buf.slice(1 + idLen, 1 + idLen + 12);
  const ciphertext = buf.slice(1 + idLen + 12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}
