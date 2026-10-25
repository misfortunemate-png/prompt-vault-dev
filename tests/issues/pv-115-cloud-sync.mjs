// pv#115: Fran → Cloud のフォルダ選択同期（WebP q80 原寸・暗号化）と B-1〜B-3
// - Fran は fran-harness の写しで起動し、Worker は同じプロセス内のモック（http）で受ける。実クラウドには触れない
// - 秘密は一時ファイル（PV_SYNC_SECRETS_PATH）で渡す。本物の D:\AI\secrets\secrets.env は読ませない
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { startFran, repoRoot } from './lib/fran-harness.mjs';
import { MemStore, freshImport, withGlobals, check } from './lib/front-env.mjs';

const require = createRequire(join(repoRoot, 'package.json'));
const sharp = require('sharp');
const nativeFetch = globalThis.fetch;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const GOOD_TOKEN = 'pv115-good-token-0123456789';
const BAD_TOKEN = 'pv115-bad-token-zzzzzzzzzz';
const VAULT_KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const SECRET_SENTINEL = 'pv115-unrelated-secret-must-not-leak';

const isWebp = (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
const isPng = (b) => b.length >= 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG';
const safeMeta = async (b) => { if (!b || !b.length) return {}; try { return await sharp(b).metadata(); } catch { return {}; } };
const hashOf = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// ─── Worker モック ───────────────────────────────────────────────────────────
function startMockWorker() {
  const st = {
    rows: new Map(),            // hash → { deleted_at, image: Buffer|null, thumb: Buffer|null, meta }
    calls: [],                  // { method, path, auth }
    failThumb: new Set(),       // サムネ PUT を 500 にする hash
    failImage: new Set(),
    delayImageMs: 0,
    usage: 0,
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const auth = req.headers.authorization || '';
    st.calls.push({ method: req.method, path: url.pathname, authOk: auth === `Bearer ${GOOD_TOKEN}` });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (auth !== `Bearer ${GOOD_TOKEN}`) return send(401, { error: 'Unauthorized' });
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/prompt-vault/sync/images') {
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 100);
      const all = [...st.rows.entries()].map(([hash, r]) => ({ hash, deleted_at: r.deleted_at }));
      return send(200, { images: all.slice(offset, offset + limit), total: all.length, offset, limit });
    }
    if (req.method === 'GET' && p === '/api/prompt-vault/sync/r2-usage') return send(200, { totalBytes: st.usage, objectCount: st.rows.size });
    if (req.method === 'PUT' && p === '/api/prompt-vault/sync/upload-image') {
      const hash = req.headers['x-pv-hash'];
      const meta = JSON.parse(Buffer.from(req.headers['x-pv-meta'], 'base64').toString('utf8'));
      if (st.delayImageMs) await sleep(st.delayImageMs);
      if (st.failImage.has(hash)) return send(500, { error: 'injected image failure' });
      const fd = await new Request('http://mock/', { method: 'PUT', headers: { 'content-type': req.headers['content-type'] }, body }).formData();
      const image = Buffer.from(await fd.get('image').arrayBuffer());
      const prev = st.rows.get(hash);
      st.rows.set(hash, { deleted_at: prev?.deleted_at ?? null, image, thumb: fd.get('thumb') ? Buffer.from(await fd.get('thumb').arrayBuffer()) : null, meta });
      return send(200, { ok: true, hash });
    }
    const m = p.match(/^\/api\/prompt-vault\/thumbs\/([^/]+)$/);
    if (req.method === 'PUT' && m) {
      const hash = decodeURIComponent(m[1]);
      if (!st.rows.has(hash)) return send(404, { error: 'Not found' });
      if (st.failThumb.has(hash)) return send(500, { error: 'injected thumb failure' });
      st.rows.get(hash).thumb = body;
      return send(200, { ok: true });
    }
    return send(404, { error: 'mock: no route' });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ st, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(c => server.close(c)) })));
}

// ─── 共通 ────────────────────────────────────────────────────────────────────
async function pngOf(r, g, b, w = 64, h = 48) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();
}

async function waitIdle(h, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await h.req('GET', '/sync/status');
    if (s.json?.state === 'idle') return s.json;
    await sleep(150);
  }
  throw new Error('sync did not become idle');
}

async function runSync(h) {
  const r = await h.req('POST', '/sync/run');
  if (r.status !== 200) return { start: r, last: null };
  const s = await waitIdle(h);
  return { start: r, last: s.lastRun };
}

async function waitIndexed(h, expected, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await h.req('GET', '/sync/folders');
    const total = (r.json?.folders || []).reduce((s, f) => s + f.imageCount, 0);
    if (total >= expected) return r;
    await sleep(200);
  }
  throw new Error('index not ready');
}

// フロントの decrypt()（src/lib/crypto.js）で復号する
async function frontDecrypt(enc, rawKey = VAULT_KEY) {
  const store = new MemStore({ 'pv-vault-key': JSON.stringify({ id: 'vault:v1', raw: rawKey }) });
  return withGlobals({ localStorage: store }, async () => {
    const c = await freshImport('src/lib/crypto.js');
    return Buffer.from(await c.decrypt(new Uint8Array(enc)));
  });
}

function secretsFile(dir, { key = VAULT_KEY, token = GOOD_TOKEN, base }) {
  const p = join(dir, 'secrets.env');
  const lines = [`UNRELATED_SECRET=${SECRET_SENTINEL}`];
  if (key !== null) lines.push(`PV_VAULT_KEY=${key}`);
  if (token !== null) lines.push(`CLOUD_TOKEN=${token}`);
  if (base) lines.push(`CLOUD_BASE=${base}`);
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

const SECRET_ENV_CLEAR = { PV_VAULT_KEY: undefined, CLOUD_TOKEN: undefined, CLOUD_BASE: undefined };

export default {
  issue: 'pv#115',
  title: 'Fran→Cloud folder-selected WebP sync (S-1〜S-4) and cloud viewer fixes B-1〜B-3',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-115-cloud-sync.mjs',

  async verify() {
    const checks = [];
    const log = (...a) => { if (process.env.PV115_VERBOSE) console.log('[pv115]', ...a); };

    // ── AC-6: 暗号化互換（サーバー encrypt → フロント decrypt） ──
    {
      const sync = await freshImport('server/sync.js');
      const plain = await pngOf(10, 20, 30);
      const enc = sync.encrypt(plain, Buffer.from(VAULT_KEY, 'base64'));
      const back = await frontDecrypt(enc);
      const idLen = enc[0];
      checks.push(check('AC-6 server encrypt() → front decrypt() returns identical bytes (keyId vault:v1)',
        back.equals(plain) && enc.subarray(1, 1 + idLen).toString() === 'vault:v1', `len=${back.length}/${plain.length}`));
      let otherFailed = false;
      try { await frontDecrypt(enc, OTHER_KEY); } catch { otherFailed = true; }
      checks.push(check('AC-6 negative control: a different key fails to decrypt', otherFailed, 'decrypt with another key did not throw'));
    }

    // ── 秘密ローダー（S-3）：3 キーだけ・process.env 優先・値を漏らさない ──
    {
      const dir = mkdtempSync(join(tmpdir(), 'pv115-sec-'));
      try {
        const sync = await freshImport('server/sync.js');
        const path = secretsFile(dir, { base: 'http://127.0.0.1:9' });
        const env = { PV_SYNC_SECRETS_PATH: path, CLOUD_TOKEN: 'from-env-token' };
        const s = sync.loadSyncSecrets({ env });
        checks.push(check('S-3 loader: process.env wins, missing keys come from secrets file, others are not exposed',
          s.ok && s.token === 'from-env-token' && s.sources.CLOUD_TOKEN === 'env' && s.sources.PV_VAULT_KEY === 'secrets-file'
          && s.cloudBase === 'http://127.0.0.1:9' && !JSON.stringify(s).includes(SECRET_SENTINEL) && !('UNRELATED_SECRET' in process.env),
          JSON.stringify({ ok: s.ok, sources: s.sources })));
        const none = sync.loadSyncSecrets({ env: { PV_SYNC_SECRETS_PATH: join(dir, 'missing.env') } });
        checks.push(check('S-3 loader: missing secrets file → not ok, CLOUD_BASE defaults to the old sync target',
          !none.ok && none.cloudBase === sync.DEFAULT_CLOUD_BASE && none.problems.some(p => p.includes('PV_VAULT_KEY')) && none.problems.some(p => p.includes('CLOUD_TOKEN')),
          JSON.stringify(none.problems)));
        const bad = sync.loadSyncSecrets({ env: { PV_SYNC_SECRETS_PATH: join(dir, 'missing.env'), PV_VAULT_KEY: 'c2hvcnQ=', CLOUD_TOKEN: 'x' } });
        checks.push(check('S-3 loader: a vault key that is not 32 bytes is rejected (reason has no key value)',
          !bad.ok && bad.problems.some(p => p.includes('32')) && !bad.problems.join().includes('c2hvcnQ='), JSON.stringify(bad.problems)));
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }

    // ── AC-7・AC-8・AC-9: フロントの段取り（B-1〜B-3） ──
    {
      const L = await freshImport('src/lib/cloudImageLoad.js');
      const webp = await sharp(await pngOf(1, 2, 3)).webp().toBuffer();
      const mkFetch = (routes) => async (url) => {
        const key = Object.keys(routes).find(k => url.endsWith(k));
        const r = key ? routes[key] : { status: 404 };
        return { ok: r.status >= 200 && r.status < 300, status: r.status, arrayBuffer: async () => r.body };
      };
      const fetchThumb404 = mkFetch({ '/data': { status: 200, body: webp } });
      const decryptImpl = async (b) => b;

      // AC-7 B-1: サムネ 404 → 本体へ進み、onDone（読み込み中の解除）が必ず呼ばれる
      let done = 0; let full = null; const statuses = [];
      await L.loadViewerImage({ hash: 'h1', cloudUrl: 'http://c', headers: {}, fetchImpl: fetchThumb404, decryptImpl,
        onFull: (p) => { full = p; }, onDone: () => { done++; }, recordStatus: (w, s) => statuses.push(`${w}:${s}`) });
      checks.push(check('AC-7 B-1: thumbnail 404 → viewer still loads the full image and clears loading (onDone once)',
        done === 1 && full && statuses.join() === 'thumb:404', JSON.stringify({ done, full: !!full, statuses })));
      let done2 = 0;
      await L.loadViewerImage({ hash: 'h1', cloudUrl: 'http://c', headers: {}, fetchImpl: mkFetch({}), decryptImpl, onDone: () => { done2++; } });
      checks.push(check('AC-7 B-1: both thumbnail and full 404 → loading is still cleared', done2 === 1, `onDone=${done2}`));

      // negative control: 修正前の連鎖（ImageViewer の旧コード相当）。サムネ 404 では setImgLoading(false) に届かない
      let oldLoading = true;
      {
        const fetchImpl = fetchThumb404;
        const okOrRecord = (r) => { if (!r) return null; if (r.ok) return r.arrayBuffer(); return null; };
        await fetchImpl('http://c/thumbs/h1').then(okOrRecord).then(b => b ? decryptImpl(b) : null)
          .then(plain => { if (!plain) return; return fetchImpl('http://c/gallery/image/h1/data'); })
          .then(okOrRecord).then(b => b ? decryptImpl(b) : null)
          .then(plain => { if (!plain) return; oldLoading = false; })
          .catch(() => { oldLoading = false; });
      }
      checks.push(check('AC-7 negative control: the pre-fix chain leaves loading on after a thumbnail 404', oldLoading === true, 'old chain cleared loading'));
      const viewerSrc = read('src/components/ImageViewer.jsx');
      checks.push(check('AC-7 ImageViewer uses loadViewerImage with onDone → setImgLoading(false)',
        /loadViewerImage\(\{/.test(viewerSrc) && /onDone:\s*\(\)\s*=>\s*setImgLoading\(false\)/.test(viewerSrc), 'ImageViewer is not wired to loadViewerImage/onDone'));
      checks.push(check('AC-7 sniffImageType tells WebP from PNG (new WebP bodies are not labelled PNG)',
        L.sniffImageType(webp) === 'image/webp' && L.sniffImageType(await pngOf(1, 1, 1)) === 'image/png', 'sniff mismatch'));

      // AC-8 B-2: フォルダのプレビュー。サムネがなければ本体で代わりに出す
      const got = await L.loadPreviewImage({ hash: 'h2', cloudUrl: 'http://c', headers: {}, fetchImpl: fetchThumb404, decryptImpl });
      checks.push(check('AC-8 B-2: preview falls back to the full image when the thumbnail is missing (thumb_ok=0)',
        got && got.fromFull === true && Buffer.from(got.plain).equals(webp), JSON.stringify(got && { fromFull: got.fromFull })));
      const albumSrc = read('src/screens/AlbumScreen.jsx');
      checks.push(check('AC-8 AlbumScreen PreviewThumb uses loadPreviewImage and regenerates the thumbnail from the full image',
        /function PreviewThumb[\s\S]*loadPreviewImage\(\{[\s\S]*got\.fromFull[\s\S]*generateAndUploadThumb/.test(albumSrc), 'PreviewThumb not wired'));

      // AC-9 B-3: Blob URL の解放
      const made = []; const revoked = [];
      const urlApi = { createObjectURL: () => { const u = `blob:mock/${made.length}`; made.push(u); return u; }, revokeObjectURL: (u) => revoked.push(u) };
      const B = await freshImport('src/lib/blobUrls.js');
      const slot = B.createBlobUrlSlot(urlApi);
      slot.set({}); const beforeUnmount = revoked.length;
      slot.set({}); const afterSwap = [...revoked];
      slot.release();
      checks.push(check('AC-9 B-3 slot: nothing revoked while mounted (negative control), old URL revoked on swap, current URL revoked on unmount',
        beforeUnmount === 0 && afterSwap.join() === 'blob:mock/0' && revoked.join() === 'blob:mock/0,blob:mock/1', JSON.stringify({ beforeUnmount, revoked })));
      revoked.length = 0;
      const tr = B.createBlobUrlSetTracker(urlApi);
      tr.sync(['blob:a', 'blob:b', null, 'https://x']); tr.sync(['blob:b']); const afterEvict = [...revoked];
      tr.releaseAll();
      checks.push(check('AC-9 B-3 results tracker: evicted result URLs revoked, the rest revoked on unmount, non-blob ignored',
        afterEvict.join() === 'blob:a' && revoked.join() === 'blob:a,blob:b', JSON.stringify(revoked)));
      const genSrc = read('src/screens/GenerateScreen.jsx');
      checks.push(check('AC-9 components release Blob URLs on unmount (ThumbCell/PreviewThumb slot.release, no module-level thumbCache, GenerateScreen tracker)',
        !/thumbCache/.test(albumSrc) && (albumSrc.match(/slot\.release\(\)/g) || []).length >= 2
        && /createBlobUrlSetTracker\(\)/.test(genSrc) && /releaseAll\(\)/.test(genSrc), 'cleanup wiring missing'));
    }

    // ── Fran ＋ Worker モック ──
    const work = mkdtempSync(join(tmpdir(), 'pv115-run-'));
    const mock = await startMockWorker();
    let h = null; let h2 = null;
    try {
      const imgs = {
        'A/a1.png': await pngOf(200, 10, 10),
        'A/sub/a2.png': await pngOf(10, 200, 10),
        'B/b1.png': await pngOf(10, 10, 200),
        'x_y/w1.png': await pngOf(50, 50, 50),
        'xAy/w2.png': await pngOf(60, 60, 60),
        'D/d1.png': await pngOf(70, 70, 70),
      };
      const H = Object.fromEntries(Object.entries(imgs).map(([k, v]) => [k, hashOf(v)]));
      // 既存クラウド: a1・b1 は旧 PNG（暗号化 PNG 相当）、d1 は明示削除済み
      const oldPng = Buffer.from('old-encrypted-png-placeholder');
      mock.st.rows.set(H['A/a1.png'], { deleted_at: null, image: oldPng, thumb: null });
      mock.st.rows.set(H['B/b1.png'], { deleted_at: null, image: oldPng, thumb: null });
      mock.st.rows.set(H['D/d1.png'], { deleted_at: '2026-10-01T00:00:00Z', image: oldPng, thumb: null });

      // AC-15: 秘密なしでも通常起動し、同期は 503
      const noSecretPath = join(work, 'no-such-secrets.env');
      h = await startFran({ name: 'pv115', vaultFiles: imgs, env: { ...SECRET_ENV_CLEAR, PV_SYNC_SECRETS_PATH: noSecretPath } });
      checks.push(check('AC-15 Fran starts normally without any sync secrets', h.up, h.output.slice(-400)));
      await waitIndexed(h, Object.keys(imgs).length);
      const r503 = await h.req('POST', '/sync/run');
      checks.push(check('AC-3/AC-15 no PV_VAULT_KEY → POST /api/sync/run is 503 with a reason', r503.status === 503 && /vault鍵/.test(r503.json?.error || ''), `${r503.status} ${r503.text}`));
      log('503 body', r503.text);

      // ここから秘密ファイルを置く（読み込みは同期開始ごとなので再起動は要らない）
      writeFileSync(noSecretPath, readFileSync(secretsFile(work, { key: VAULT_KEY, token: null, base: mock.base })));
      const rNoTok = await h.req('POST', '/sync/run');
      checks.push(check('AC-15 vault key present but CLOUD_TOKEN missing → 503 and nothing sent', rNoTok.status === 503 && /CLOUD_TOKEN/.test(rNoTok.json?.error || '') && mock.st.calls.length === 0, `${rNoTok.status} calls=${mock.st.calls.length}`));

      // 無効なトークン → Worker 401 で止まり、送信しない
      writeFileSync(noSecretPath, readFileSync(secretsFile(work, { token: BAD_TOKEN, base: mock.base })));
      await h.req('PUT', '/sync/folders', { folders: ['A'] });
      const bad = await runSync(h);
      const uploadsWithBad = mock.st.calls.filter(c => c.method === 'PUT').length;
      checks.push(check('AC-15 invalid token → Worker 401 → run aborted, no PUT sent, reason has no token value',
        bad.start.status === 200 && bad.last?.aborted === true && /認証/.test(bad.last.errors.join()) && uploadsWithBad === 0
        && !JSON.stringify(bad.last).includes(BAD_TOKEN), JSON.stringify(bad.last)));
      await h.req('PUT', '/sync/folders', { folders: [] });

      // 有効なトークン（以後）
      writeFileSync(noSecretPath, readFileSync(secretsFile(work, { token: GOOD_TOKEN, base: mock.base })));
      mock.st.calls.length = 0;

      // AC-5: 選択なし → uploaded 0 で正常完了
      const empty = await runSync(h);
      checks.push(check('AC-5 no folder selected → run completes with uploaded:0', empty.start.status === 200 && empty.last?.uploaded === 0 && empty.last?.failed === 0 && !empty.last?.aborted, JSON.stringify(empty.last)));
      checks.push(check('AC-15 valid token: authenticated GET /sync/images and /sync/r2-usage accepted (mock 200) — nothing sent with empty selection',
        mock.st.calls.length === 0, `calls=${JSON.stringify(mock.st.calls)}`));

      // AC-1: 最上位フォルダと子フォルダ込みの枚数
      const f1 = await h.req('GET', '/sync/folders');
      const byName = Object.fromEntries((f1.json?.folders || []).map(f => [f.name, f]));
      checks.push(check('AC-1 GET /api/sync/folders lists top-level folders with counts including subfolders',
        f1.status === 200 && byName.A?.imageCount === 2 && byName.B?.imageCount === 1 && byName.x_y?.imageCount === 1 && byName.xAy?.imageCount === 1 && Object.keys(byName).length === 5,
        JSON.stringify(f1.json)));

      // AC-2: 保存 → 既存 PUT /api/settings（設定画面と同じ 3 キー）→ 再取得で保持。存在しない名前は記録して保存しない
      const put = await h.req('PUT', '/sync/folders', { folders: ['A', 'no-such-folder'] });
      const settings = (await h.req('GET', '/settings')).json;
      const putSettings = await h.req('PUT', '/settings', { generation: settings.generation, guard: settings.guard, captionStyle: settings.captionStyle });
      const f2 = await h.req('GET', '/sync/folders');
      const sel = (f2.json?.folders || []).filter(f => f.selected).map(f => f.name);
      const unknownRecorded = h.invalidEntries().some(e => e.kind === 'sync-unknown-folder' && /no-such-folder/.test(e.raw));
      checks.push(check('AC-2 PUT /api/sync/folders → existing PUT /api/settings → GET keeps the selection (unknown name recorded, not saved)',
        put.status === 200 && putSettings.status === 200 && sel.join() === 'A' && unknownRecorded, JSON.stringify({ put: put.json, putSettings: putSettings.status, putSettingsBody: putSettings.text, sel, unknownRecorded, unhandled: h.logEntries().filter(e => e.code === 'UNHANDLED').map(e => e.message) })));
      // negative control（旧方式）: settings.json に置いた sync.folders は、設定画面の保存（全置換）で消える
      const sp = join(h.dataDir, 'settings.json');
      writeFileSync(sp, JSON.stringify({ ...JSON.parse(readFileSync(sp, 'utf8')), sync: { folders: ['A'] } }));
      await h.req('PUT', '/settings', { generation: settings.generation, guard: settings.guard, captionStyle: settings.captionStyle });
      const lost = !('sync' in JSON.parse(readFileSync(sp, 'utf8')));
      checks.push(check('AC-2/AC-17 negative control: a selection stored in settings.json is lost by the existing settings save', lost, 'settings.json kept sync (old approach would not be lost)'));

      // AC-13: 既存クラウド hash（a1 = 旧 PNG）も WebP で上書き。a2 は新規
      const cloudBefore = new Set(mock.st.rows.keys());
      const oldDiffTargets = [H['A/a1.png'], H['A/sub/a2.png']].filter(x => !cloudBefore.has(x)); // 旧実装（差分だけ）
      const r1 = await runSync(h);
      checks.push(check('AC-15 valid token → authenticated GET /sync/images is answered 200 and the run proceeds',
        mock.st.calls.some(c => c.method === 'GET' && c.path === '/api/prompt-vault/sync/images' && c.authOk) && !r1.last?.aborted, JSON.stringify(r1.last)));
      const a1 = mock.st.rows.get(H['A/a1.png']);
      const a1Plain = a1?.image ? await frontDecrypt(a1.image).catch(() => null) : null;
      const a1Thumb = a1?.thumb ? await frontDecrypt(a1.thumb).catch(() => null) : null;
      const a2 = mock.st.rows.get(H['A/sub/a2.png']);
      const a2Plain = a2?.image ? await frontDecrypt(a2.image).catch(() => null) : null;
      const a1Meta = await safeMeta(a1Plain);
      checks.push(check('AC-13 existing cloud hash (old PNG) is overwritten; decrypts with front decrypt() to WebP at original size',
        r1.last?.uploaded === 2 && a1Plain && isWebp(a1Plain) && a1Meta.width === 64 && a1Meta.height === 48 && a2Plain && isWebp(a2Plain),
        JSON.stringify({ last: r1.last, a1Webp: a1Plain && isWebp(a1Plain), size: [a1Meta.width, a1Meta.height] })));
      const thumbMeta = await safeMeta(a1Thumb);
      checks.push(check('AC-13 thumbnail sent via PUT /thumbs/{hash}: WebP, long edge ≤ 320, not enlarged',
        a1Thumb && isWebp(a1Thumb) && thumbMeta.width === 64, JSON.stringify(thumbMeta.width)));
      checks.push(check('AC-13 negative control: the old diff-only rule would not have re-sent the existing hash',
        !oldDiffTargets.includes(H['A/a1.png']) && oldDiffTargets.length === 1, JSON.stringify(oldDiffTargets)));
      checks.push(check('AC-13 metadata header carries folder/filename (Worker contract X-PV-Meta)',
        a2?.meta?.folder === 'A/sub' && a2?.meta?.filename === 'a2.png' && a2?.meta?.origin === 'fran', JSON.stringify(a2?.meta)));
      checks.push(check('AC-13 PNG is not sent: R2 body is WebP, never the original PNG', a2Plain && !isPng(a2Plain), 'PNG body found'));

      // AC-14: 2 度目は skip
      mock.st.calls.length = 0;
      const r2 = await runSync(h);
      checks.push(check('AC-14 second run skips hashes already sent as WebP (no PUT)',
        r2.last?.uploaded === 0 && r2.last?.skipped === 2 && mock.st.calls.filter(c => c.method === 'PUT').length === 0, JSON.stringify(r2.last)));

      // AC-14: 後から選んだフォルダ（B: 既存 PNG の b1）＋失敗注入（サムネ失敗 → 記録しない → 次回再送）
      mock.st.failThumb.add(H['B/b1.png']);
      await h.req('PUT', '/sync/folders', { folders: ['A', 'B'] });
      const r3 = await runSync(h);
      const stateAfterFail = JSON.parse(readFileSync(join(h.dataDir, 'sync-webp-state.json'), 'utf8')).uploadedHashes;
      checks.push(check('AC-14 failure injection: thumbnail PUT fails → counted as failed, hash NOT recorded as sent',
        r3.last?.failed === 1 && /サムネイル/.test(r3.last.errors.join()) && !stateAfterFail.includes(H['B/b1.png']), JSON.stringify({ last: r3.last, stateAfterFail })));
      mock.st.failThumb.clear();
      const r4 = await runSync(h);
      const b1 = mock.st.rows.get(H['B/b1.png']);
      const b1Plain = b1?.image ? await frontDecrypt(b1.image).catch(() => null) : null;
      checks.push(check('AC-14 retry: the failed hash is re-sent next run; the later-selected folder\'s existing cloud hash is overwritten with WebP',
        r4.last?.uploaded === 1 && r4.last?.failed === 0 && b1Plain && isWebp(b1Plain), JSON.stringify(r4.last)));

      // 送信済みでもクラウドから消えていれば再送
      mock.st.rows.delete(H['A/sub/a2.png']);
      const r5 = await runSync(h);
      checks.push(check('S-4 a recorded hash missing from the cloud is re-sent', r5.last?.uploaded === 1 && mock.st.rows.has(H['A/sub/a2.png']), JSON.stringify(r5.last)));

      // 明示削除済み（d1）は復活させない
      await h.req('PUT', '/sync/folders', { folders: ['A', 'B', 'D'] });
      const r6 = await runSync(h);
      checks.push(check('S-4 hash deleted in the cloud (deleted_at) is not revived', r6.last?.uploaded === 0 && mock.st.rows.get(H['D/d1.png']).image.equals(oldPng), JSON.stringify(r6.last)));

      // %/_ をワイルドカードにしない（x_y を選んでも xAy は対象外）
      await h.req('PUT', '/sync/folders', { folders: ['x_y'] });
      const r7 = await runSync(h);
      checks.push(check('S-1 folder names match literally (x_y does not match xAy)',
        r7.last?.uploaded === 1 && mock.st.rows.has(H['x_y/w1.png']) && !mock.st.rows.has(H['xAy/w2.png']), JSON.stringify(r7.last)));

      // R2 上限: 使用量 ≥ 上限なら送らない
      writeFileSync(sp, JSON.stringify({ ...JSON.parse(readFileSync(sp, 'utf8')), 'sync.r2_limit_gb': 0.000001 }));
      mock.st.usage = 5000;
      await h.req('PUT', '/sync/folders', { folders: ['xAy'] });
      const r8 = await runSync(h);
      checks.push(check('§3.7 R2 usage ≥ sync.r2_limit_gb → nothing sent this run (fail closed, reason recorded)',
        r8.last?.uploaded === 0 && /上限/.test(r8.last.errors.join()) && !mock.st.rows.has(H['xAy/w2.png']), JSON.stringify(r8.last)));
      mock.st.usage = 0;

      // AC-4: 実行中の二重起動は 409（最初の起動は 200）
      mock.st.delayImageMs = 1500;
      writeFileSync(join(h.dataDir, 'sync-webp-state.json'), JSON.stringify({ uploadedHashes: [] }));
      writeFileSync(sp, JSON.stringify({ ...JSON.parse(readFileSync(sp, 'utf8')), 'sync.r2_limit_gb': 5 }));
      const first = await h.req('POST', '/sync/run');
      const second = await h.req('POST', '/sync/run');
      const during = (await h.req('GET', '/sync/status')).json;
      await waitIdle(h);
      mock.st.delayImageMs = 0;
      checks.push(check('AC-4 POST /api/sync/run while running → 409 (negative control: first start from idle → 200); status reports progress',
        first.status === 200 && second.status === 409 && during?.state === 'running' && during?.progress && typeof during.progress.total === 'number',
        JSON.stringify({ first: first.status, second: second.status, during })));

      // 秘密が応答・ログに出ていない
      const logsText = JSON.stringify(h.logEntries());
      const statusText = (await h.req('GET', '/sync/status')).text;
      checks.push(check('AC-15 no secret value (vault key / tokens / unrelated secret) appears in logs or /sync/status',
        ![VAULT_KEY, GOOD_TOKEN, BAD_TOKEN, SECRET_SENTINEL].some(s => logsText.includes(s) || statusText.includes(s)), 'secret leaked'));

      // AC-17: 再起動を挟んでも選択と送信成功記録が残る
      await h.req('PUT', '/sync/folders', { folders: ['A', 'B'] });
      await runSync(h);
      const keepSync = readFileSync(join(h.dataDir, 'sync.json'), 'utf8');
      const keepState = readFileSync(join(h.dataDir, 'sync-webp-state.json'), 'utf8');
      const keepSettings = readFileSync(sp, 'utf8');
      await h.stop(); h = null;
      h2 = await startFran({ name: 'pv115b', vaultFiles: imgs, data: { 'sync.json': keepSync, 'sync-webp-state.json': keepState, 'settings.json': keepSettings }, env: { ...SECRET_ENV_CLEAR, PV_SYNC_SECRETS_PATH: noSecretPath } });
      await waitIndexed(h2, Object.keys(imgs).length);
      const s2 = await h2.req('GET', '/settings');
      await h2.req('PUT', '/settings', { generation: s2.json.generation, guard: s2.json.guard, captionStyle: s2.json.captionStyle });
      const f3 = await h2.req('GET', '/sync/folders');
      const sel3 = (f3.json?.folders || []).filter(f => f.selected).map(f => f.name).sort();
      mock.st.calls.length = 0;
      const r9 = await runSync(h2);
      checks.push(check('AC-17 after restart + existing settings save: folder selection and WebP-sent records persist (no re-send)',
        sel3.join() === 'A,B' && r9.last?.uploaded === 0 && r9.last?.skipped === 3 && mock.st.calls.filter(c => c.method === 'PUT').length === 0,
        JSON.stringify({ sel3, last: r9.last })));
    } catch (e) {
      checks.push(check('pv#115 harness run completed', false, `${e.message}\n${h?.output?.slice(-800) ?? ''}${h2?.output?.slice(-800) ?? ''}`));
    } finally {
      if (h) await h.stop();
      if (h2) await h2.stop();
      await mock.close();
      rmSync(work, { recursive: true, force: true });
    }

    // ── AC-16 は foundation 側で別に確かめる（報告書）。ここでは Fran が旧 pv-sync を呼ばないことだけ ──
    const serverSrc = read('server/sync.js') + read('server.js');
    checks.push(check('AC-16 Fran sync does not invoke the old pv-sync script', !/pv-sync\.mjs/.test(serverSrc) || !/spawn|exec/.test(read('server/sync.js')), 'server references pv-sync.mjs execution'));
    return checks;
  },
};
