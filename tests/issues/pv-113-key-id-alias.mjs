// pv#113: 鍵 id 'v1'（pv-sync が書く）を 'vault:v1' と同じ鍵を指す当たる枝にする（J-2・J-8）
import { MemStore, freshImport, withGlobals, check } from './lib/front-env.mjs';

// フロントと同じ形式 [idLen][keyId][IV12][本文+tag] の暗号文を、任意の keyId で作る（pv-sync と同じ作り方）
async function encryptWithKeyId(rawB64, keyId, plain) {
  const key = await crypto.subtle.importKey('raw', Buffer.from(rawB64, 'base64'), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const id = new TextEncoder().encode(keyId);
  const out = new Uint8Array(1 + id.length + 12 + ct.length);
  out[0] = id.length; out.set(id, 1); out.set(iv, 1 + id.length); out.set(ct, 1 + id.length + 12);
  return out;
}

export default {
  issue: 'pv#113',
  title: "Ciphertext keyId 'v1' is the same key as 'vault:v1' (defined branch); other mismatches are still recorded",
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-113-key-id-alias.mjs',

  async verify() {
    const checks = [];
    const raw = Buffer.alloc(32, 11).toString('base64');
    const store = new MemStore({ 'pv-vault-key': JSON.stringify({ id: 'vault:v1', raw }) });
    await withGlobals({ localStorage: store }, async () => {
      const log = await freshImport('src/lib/invalidLog.js');
      const c = await freshImport('src/lib/crypto.js');
      const run = async (keyId) => {
        store.removeItem('pv-invalid-log');
        const enc = await encryptWithKeyId(raw, keyId, `hello ${keyId}`);
        let plain = null;
        try { plain = new TextDecoder().decode(await c.decrypt(enc)); } catch (e) { plain = `ERR ${e.message}`; }
        return { plain, entries: log.getInvalidLog().filter(e => /key-id/.test(e.kind)) };
      };
      const v1 = await run('v1');
      checks.push(check("'v1' ciphertext decrypts and is not recorded (defined branch)", v1.plain === 'hello v1' && v1.entries.length === 0, JSON.stringify(v1)));
      const same = await run('vault:v1');
      checks.push(check("control: 'vault:v1' ciphertext decrypts and is not recorded", same.plain === 'hello vault:v1' && same.entries.length === 0, JSON.stringify(same)));
      const other = await run('vault:v2');
      checks.push(check("another keyId ('vault:v2') is still recorded (J-8) and decryption is still attempted",
        other.plain === 'hello vault:v2' && other.entries.length === 1 && /vault:v2/.test(other.entries[0].raw), JSON.stringify(other)));
      const v2 = await run('v2');
      checks.push(check("'v2' is not treated as an alias (only 'v1' is)", v2.entries.length === 1, JSON.stringify(v2)));
    });
    return checks;
  },
};
