// pv#115 AC-15 証跡用: Fran の写し（fran-harness）を本物の Worker（既定の CLOUD_BASE）に向け、
// ダミーのトークンと使い捨ての乱数鍵で同期させる。Worker が 401 を返し、送信（PUT）が始まらないことを確かめる。
// 本物の秘密は使わない（PV_SYNC_SECRETS_PATH は存在しないパス）。
// 実行: node docs/reports/pv-115/ac15-real-worker-e2e.mjs
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startFran, repoRoot } from '../../../tests/issues/lib/fran-harness.mjs';

const require = createRequire(join(repoRoot, 'package.json'));
const sharp = require('sharp');
const DUMMY_TOKEN = 'pv115-invalid-dummy-token';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
const h = await startFran({
  name: 'pv115-real',
  vaultFiles: { 'E2E/one.png': png },
  env: {
    PV_SYNC_SECRETS_PATH: join(repoRoot, '.no-such-secrets.env'),
    PV_VAULT_KEY: randomBytes(32).toString('base64'), // 使い捨て（本番の鍵ではない）
    CLOUD_TOKEN: DUMMY_TOKEN,
    CLOUD_BASE: undefined,                            // 既定 = 本物の Worker
  },
});
try {
  console.log('fran up:', h.up);
  for (let i = 0; i < 100; i++) {
    const f = await h.req('GET', '/sync/folders');
    if ((f.json?.folders || []).some(x => x.name === 'E2E')) break;
    await sleep(200);
  }
  console.log('PUT /sync/folders:', (await h.req('PUT', '/sync/folders', { folders: ['E2E'] })).text);
  const start = await h.req('POST', '/sync/run');
  console.log('POST /sync/run:', start.status, start.text);
  let s;
  for (let i = 0; i < 200; i++) { s = (await h.req('GET', '/sync/status')).json; if (s?.state === 'idle') break; await sleep(150); }
  console.log('lastRun:', JSON.stringify(s?.lastRun));
  const leaked = h.output.includes(DUMMY_TOKEN) || JSON.stringify(h.logEntries()).includes(DUMMY_TOKEN) || JSON.stringify(s).includes(DUMMY_TOKEN);
  const ok = start.status === 200 && s?.lastRun?.aborted === true && s.lastRun.uploaded === 0 && /認証に失敗しました（401）/.test(s.lastRun.errors.join());
  console.log('token value in output/logs/status:', leaked);
  console.log('VERDICT', ok && !leaked ? 'PASS (real Worker 401 → sync aborted before any upload)' : 'FAIL');
} finally {
  await h.stop();
}
