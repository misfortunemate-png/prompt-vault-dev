// pv#115 AC-15: 秘密を置いた後の、実 Worker への接続と鍵の確認（読み取りだけ・何も送らない）
// - server/sync.js と同じ規則で秘密を読む（process.env 優先、欠けた 3 キーだけ secrets.env から）
// - 有効なトークンで GET /sync/images・/sync/r2-usage が 200 になること
// - クラウドにある 1 件のサムネ（なければ本体）を PV_VAULT_KEY で復号できること（Pixel の鍵と同じかの目安）
// 秘密の値は表示しない（出所と長さだけ）
import { createDecipheriv } from 'node:crypto';
import { loadSyncSecrets } from '../server/sync.js';

function decrypt(buf, key) {
  const idLen = buf[0];
  const keyId = buf.subarray(1, 1 + idLen).toString('utf8');
  const iv = buf.subarray(1 + idLen, 13 + idLen);
  const body = buf.subarray(13 + idLen);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(body.subarray(body.length - 16));
  return { keyId, plain: Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]) };
}

const s = loadSyncSecrets();
console.log('sources:', JSON.stringify(s.sources), 'token length:', s.token ? s.token.length : 0, 'cloudBase:', s.cloudBase);
if (!s.ok) {
  console.log('NOT READY:', s.problems.join(' / '));
  process.exit(2);
}
const get = (path) => fetch(`${s.cloudBase}/api/prompt-vault${path}`, { headers: { Authorization: `Bearer ${s.token}` } });

let pass = true;
const inv = await get('/sync/images?offset=0&limit=1');
console.log('GET /sync/images?limit=1 →', inv.status);
if (!inv.ok) pass = false;
const usage = await get('/sync/r2-usage');
console.log('GET /sync/r2-usage →', usage.status, usage.ok ? `totalBytes=${(await usage.json()).totalBytes}` : '');
if (!usage.ok) pass = false;

if (inv.ok) {
  const data = await inv.json();
  console.log('cloud images total:', data.total);
  const hash = data.images?.[0]?.hash;
  if (hash) {
    let res = await get(`/thumbs/${hash}`);
    let what = 'thumb';
    if (!res.ok) { res = await get(`/gallery/image/${hash}/data`); what = 'image'; }
    if (res.ok) {
      try {
        const { keyId, plain } = decrypt(Buffer.from(await res.arrayBuffer()), s.vaultKey);
        console.log(`decrypt ${what} ${hash}: OK (keyId=${keyId}, ${plain.length} bytes)`);
      } catch (e) {
        console.log(`decrypt ${what} ${hash}: FAILED (${e.message}) — PV_VAULT_KEY がクラウドの暗号文の鍵と違う可能性`);
        pass = false;
      }
    } else {
      console.log(`fetch ${what} ${hash}: ${res.status}（復号の確認はできない）`);
    }
  } else {
    console.log('cloud has no image; key check skipped');
  }
}
console.log('VERDICT', pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
