// pv#115: Fran → Cloud の画像同期（選択した最上位フォルダの画像を WebP q80 原寸＋サムネに変換し、vault 鍵で暗号化して Worker へ送る）
// - 同期選択は data/sync.json、WebP 送信成功の記録は data/sync-webp-state.json（どちらも settings.json と分ける・S-1/S-4）
// - 秘密は process.env を優先し、欠けた PV_VAULT_KEY・CLOUD_TOKEN・CLOUD_BASE の 3 キーだけを secrets.env から読む（S-3）
// - 秘密の値はログ・エラー・応答に入れない（J-3）。記録は種別と長さだけ（describeSecret）
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { recordInvalid, recordEvent, describeSecret } from './log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export const DEFAULT_CLOUD_BASE = 'https://ai-family-foundation.misfortunemate.workers.dev';
export const DEFAULT_SECRETS_PATH = 'D:\\AI\\secrets\\secrets.env';
const SECRET_KEYS = ['PV_VAULT_KEY', 'CLOUD_TOKEN', 'CLOUD_BASE'];
const DEFAULT_KEY_ID = 'vault:v1';
const R2_LIMIT_DEFAULT_GB = 5;
const INVENTORY_PAGE = 500;
const ERRORS_KEPT = 20;
const STATE_FLUSH_EVERY = 10;
const THUMB_EDGE = 320;
const WEBP_QUALITY = 80;

// ─── 秘密の読み込み（S-3） ───────────────────────────────────────────────────

// secrets.env から 3 キーだけを取り出す。ファイル内の他の値は返さず、process.env にも入れない
function readSecretsFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { values: {}, found: false };
    recordInvalid({ kind: 'sync-secrets-unreadable', stage: 'pv#115 sync.loadSecrets', raw: { path, code: e.code ?? null }, reason: `秘密ファイルが読めない: ${e.message}` });
    return { values: {}, found: false };
  }
  const all = parseEnv(text);
  const values = {};
  for (const k of SECRET_KEYS) if (typeof all[k] === 'string' && all[k] !== '') values[k] = all[k];
  return { values, found: true };
}

// 戻り値: { ok, problems[], vaultKey(Buffer|null), token, cloudBase, sources }
// problems は利用者に見せてよい理由だけ（値は含めない）
export function loadSyncSecrets({ env = process.env, secretsPath } = {}) {
  const path = secretsPath || env.PV_SYNC_SECRETS_PATH || DEFAULT_SECRETS_PATH;
  const file = readSecretsFile(path);
  const pick = (k) => {
    if (typeof env[k] === 'string' && env[k] !== '') return { value: env[k], source: 'env' };
    if (k in file.values) return { value: file.values[k], source: 'secrets-file' };
    return { value: null, source: null };
  };
  const key = pick('PV_VAULT_KEY');
  const token = pick('CLOUD_TOKEN');
  const base = pick('CLOUD_BASE');
  const problems = [];

  let vaultKey = null;
  if (key.value === null) {
    problems.push('vault鍵（PV_VAULT_KEY）が設定されていません');
  } else {
    const s = key.value.trim();
    const buf = /^[A-Za-z0-9+/]+={0,2}$/.test(s) ? Buffer.from(s, 'base64') : null;
    if (!buf || buf.length !== 32) {
      recordInvalid({ kind: 'sync-vault-key-invalid', stage: 'pv#115 sync.loadSecrets', raw: describeSecret(key.value), reason: `PV_VAULT_KEY が base64 の 32 バイト鍵でない（source=${key.source}）` });
      problems.push('vault鍵（PV_VAULT_KEY）が base64 の 32 バイト鍵ではありません');
    } else {
      vaultKey = buf;
    }
  }

  if (token.value === null) problems.push('クラウドのトークン（CLOUD_TOKEN）が設定されていません');

  let cloudBase = DEFAULT_CLOUD_BASE;
  if (base.value !== null) {
    let u = null;
    try { u = new URL(base.value.trim()); } catch {}
    if (!u || !['https:', 'http:'].includes(u.protocol)) {
      recordInvalid({ kind: 'sync-cloud-base-invalid', stage: 'pv#115 sync.loadSecrets', raw: base.value, reason: `CLOUD_BASE が http(s) の URL でない（source=${base.source}）` });
      problems.push('CLOUD_BASE が URL ではありません');
    } else {
      cloudBase = u.origin + u.pathname.replace(/\/+$/, '');
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    vaultKey,
    token: token.value,
    cloudBase,
    sources: { PV_VAULT_KEY: key.source, CLOUD_TOKEN: token.source, CLOUD_BASE: base.source ?? 'default', secretsFile: file.found ? path : null },
  };
}

// ─── 暗号化（src/lib/crypto.js と同じ形式） ──────────────────────────────────
// [1byte: key_id長][key_id UTF-8][12bytes: IV][ciphertext + tag16]
export function encrypt(plainBuffer, keyBuffer, keyId = DEFAULT_KEY_ID) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const idBytes = Buffer.from(keyId, 'utf-8');
  const result = Buffer.alloc(1 + idBytes.length + 12 + encrypted.length + tag.length);
  result[0] = idBytes.length;
  idBytes.copy(result, 1);
  iv.copy(result, 1 + idBytes.length);
  encrypted.copy(result, 1 + idBytes.length + 12);
  tag.copy(result, 1 + idBytes.length + 12 + encrypted.length);
  return result;
}

// ─── ランタイムデータ（原子的に書く） ────────────────────────────────────────

function atomicWriteJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}

// 解析できない・形が違うファイルは消さずに .corrupt へ写し、記録してから空として扱う（C-1）
function readJsonFile(filePath, stage, isValid, empty) {
  if (!existsSync(filePath)) return empty();
  const text = readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    try { copyFileSync(filePath, `${filePath}.corrupt`); } catch {}
    recordInvalid({ kind: 'sync-data-file-unparseable', stage, raw: text, reason: `JSON として解析できない（${filePath}.corrupt に写して空として扱う）: ${e.message}` });
    return empty();
  }
  if (!isValid(data)) {
    try { copyFileSync(filePath, `${filePath}.corrupt`); } catch {}
    recordInvalid({ kind: 'sync-data-file-invalid', stage, raw: text, reason: `形が違う（${filePath}.corrupt に写して空として扱う）` });
    return empty();
  }
  return data;
}

const isStringArrayDoc = (key) => (d) => d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d[key]) && d[key].every(x => typeof x === 'string');

// ─── 同期サービス ────────────────────────────────────────────────────────────

export function createSyncService({
  dataDir = join(ROOT, 'data'),
  dbPath = join(dataDir, 'index.db'),
  getVaultRoot = () => process.env.VAULT_ROOT,
  env = process.env,
  fetchImpl = (...a) => globalThis.fetch(...a),
} = {}) {
  const SYNC_PATH = join(dataDir, 'sync.json');
  const STATE_PATH = join(dataDir, 'sync-webp-state.json');
  const SETTINGS_PATH = join(dataDir, 'settings.json');

  let db = null;
  const getDb = () => {
    if (!db) {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    }
    return db;
  };

  let syncState = { state: 'idle', lastRun: null, progress: null };

  const readSelection = () => readJsonFile(SYNC_PATH, 'pv#115 sync.readSelection', isStringArrayDoc('folders'), () => ({ folders: [] })).folders;
  const writeSelection = (folders) => atomicWriteJson(SYNC_PATH, { folders });
  const readUploaded = () => new Set(readJsonFile(STATE_PATH, 'pv#115 sync.readWebpState', isStringArrayDoc('uploadedHashes'), () => ({ uploadedHashes: [] })).uploadedHashes);
  const writeUploaded = (set) => atomicWriteJson(STATE_PATH, { uploadedHashes: [...set] });

  // 最上位フォルダと（子フォルダを含む）画像数
  function listTopFolders() {
    if (!existsSync(dbPath)) return [];
    return getDb().prepare(`
      SELECT substr(folder, 1, instr(folder || '/', '/') - 1) AS name, COUNT(*) AS imageCount
      FROM images GROUP BY name ORDER BY name
    `).all();
  }

  // 完全一致か「名前 + '/'」で始まる子フォルダ。LIKE を使わないので % と _ を文字として扱う
  function listImagesIn(folders) {
    if (folders.length === 0) return [];
    const where = folders.map(() => '(folder = ? OR substr(folder, 1, length(?) + 1) = ? || \'/\')').join(' OR ');
    const params = folders.flatMap(f => [f, f, f]);
    return getDb().prepare(`
      SELECT hash, rel_path, filename, folder, size_bytes, width, height, prompt, negative, char_prompts,
             seed, model, steps, scale, sampler, preset_id, favorite, caption, meta_updated_at, created_at, modified_at
      FROM images WHERE ${where} ORDER BY created_at DESC
    `).all(...params);
  }

  function r2LimitBytes() {
    let gb = R2_LIMIT_DEFAULT_GB;
    let settings = null;
    try { settings = existsSync(SETTINGS_PATH) ? JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) : null; } catch (e) {
      recordInvalid({ kind: 'sync-settings-unparseable', stage: 'pv#115 sync.r2Limit', raw: SETTINGS_PATH, reason: `settings.json が読めない（既定の ${R2_LIMIT_DEFAULT_GB}GB）: ${e.message}` });
    }
    if (settings && 'sync.r2_limit_gb' in settings) {
      const v = settings['sync.r2_limit_gb'];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) gb = v;
      else recordInvalid({ kind: 'sync-r2-limit-invalid', stage: 'pv#115 sync.r2Limit', raw: v, reason: `'sync.r2_limit_gb' が正の数でない（既定の ${R2_LIMIT_DEFAULT_GB}GB）` });
    }
    return gb * 1024 * 1024 * 1024;
  }

  // ── フォルダ選択 API ──
  function getFolders() {
    const selected = new Set(readSelection());
    const tops = listTopFolders();
    const known = new Set(tops.map(t => t.name));
    for (const f of selected) {
      if (!known.has(f)) recordInvalid({ kind: 'sync-selected-folder-missing', stage: 'pv#115 GET /api/sync/folders', raw: f, reason: '保存済みの同期フォルダがギャラリーインデックスにない（一覧には出さない）' });
    }
    return { folders: tops.map(t => ({ name: t.name, selected: selected.has(t.name), imageCount: t.imageCount })) };
  }

  // 戻り値: { status, body }
  function putFolders(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.folders)) {
      recordInvalid({ kind: 'sync-folders-body-invalid', stage: 'pv#115 PUT /api/sync/folders', raw: body, reason: '{ folders: string[] } でない（保存しない）' });
      return { status: 400, body: { error: '{ "folders": [...] } の形で送ってください' } };
    }
    const known = new Set(listTopFolders().map(t => t.name));
    const valid = [];
    for (const f of body.folders) {
      if (typeof f !== 'string') {
        recordInvalid({ kind: 'sync-folder-not-string', stage: 'pv#115 PUT /api/sync/folders', raw: f, reason: 'フォルダ名が文字列でない（保存しない）' });
      } else if (!known.has(f)) {
        recordInvalid({ kind: 'sync-unknown-folder', stage: 'pv#115 PUT /api/sync/folders', raw: f, reason: '指定されたフォルダがギャラリーインデックスに存在しない（保存しない）' });
      } else if (!valid.includes(f)) {
        valid.push(f);
      }
    }
    writeSelection(valid);
    return { status: 200, body: { ok: true, folders: valid, ignored: body.folders.length - valid.length } };
  }

  // ── クラウド呼び出し ──
  const authError = (status) => Object.assign(new Error(`クラウドの認証に失敗しました（${status}）。送信を止めました`), { fatal: true, status });

  async function cloudFetch(secrets, path, init = {}) {
    const res = await fetchImpl(`${secrets.cloudBase}/api/prompt-vault${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${secrets.token}`, 'User-Agent': 'prompt-vault-sync/1.0' },
    });
    if (res.status === 401 || res.status === 403) throw authError(res.status);
    return res;
  }

  async function fetchCloudInventory(secrets) {
    const map = new Map(); // hash → deleted_at|null
    let offset = 0;
    for (;;) {
      let res;
      try {
        res = await cloudFetch(secrets, `/sync/images?offset=${offset}&limit=${INVENTORY_PAGE}`);
      } catch (e) {
        if (e.fatal) throw e;
        throw Object.assign(new Error(`クラウドの画像一覧を取得できません（通信失敗: ${e.message}）。送信しません`), { fatal: true });
      }
      if (!res.ok) throw Object.assign(new Error(`クラウドの画像一覧を取得できません（${res.status}）。送信しません`), { fatal: true });
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.images)) {
        recordInvalid({ kind: 'sync-inventory-shape', stage: 'pv#115 sync.fetchCloudInventory', raw: data, reason: 'images 配列がない（送信しない）' });
        throw Object.assign(new Error('クラウドの画像一覧の形が違います。送信しません'), { fatal: true });
      }
      for (const img of data.images) {
        if (img && typeof img.hash === 'string') map.set(img.hash, img.deleted_at ?? null);
        else recordInvalid({ kind: 'sync-inventory-item', stage: 'pv#115 sync.fetchCloudInventory', raw: img, reason: 'hash のない行（読み飛ばす）' });
      }
      offset += data.images.length;
      const total = typeof data.total === 'number' ? data.total : null;
      if (data.images.length < INVENTORY_PAGE || (total !== null && offset >= total) || data.images.length === 0) break;
    }
    return map;
  }

  async function fetchR2Usage(secrets) {
    let res;
    try {
      res = await cloudFetch(secrets, '/sync/r2-usage');
    } catch (e) {
      if (e.fatal) throw e;
      throw Object.assign(new Error(`R2 の使用量を取得できません（通信失敗: ${e.message}）。送信しません`), { fatal: true });
    }
    if (!res.ok) throw Object.assign(new Error(`R2 の使用量を取得できません（${res.status}）。送信しません`), { fatal: true });
    const data = await res.json().catch(() => null);
    if (!data || typeof data.totalBytes !== 'number') {
      recordInvalid({ kind: 'sync-r2-usage-shape', stage: 'pv#115 sync.fetchR2Usage', raw: data, reason: 'totalBytes が数でない（送信しない）' });
      throw Object.assign(new Error('R2 の使用量の形が違います。送信しません'), { fatal: true });
    }
    return data.totalBytes;
  }

  function metaHeader(img) {
    const meta = {
      filename: img.filename, folder: img.folder, rel_path: img.rel_path, size_bytes: img.size_bytes,
      width: img.width, height: img.height, prompt: img.prompt, negative: img.negative, char_prompts: img.char_prompts,
      seed: img.seed, model: img.model, steps: img.steps, scale: img.scale, sampler: img.sampler,
      preset_id: img.preset_id, favorite: img.favorite, caption: img.caption, meta_updated_at: img.meta_updated_at,
      created_at: img.created_at, modified_at: img.modified_at, origin: 'fran',
    };
    return Buffer.from(JSON.stringify(meta), 'utf8').toString('base64');
  }

  async function uploadOne(secrets, img) {
    const vaultRoot = getVaultRoot();
    const png = await readFile(join(vaultRoot, img.rel_path));
    const webp = await sharp(png).webp({ quality: WEBP_QUALITY }).toBuffer();
    const thumb = await sharp(png)
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    const encImage = encrypt(webp, secrets.vaultKey);
    const encThumb = encrypt(thumb, secrets.vaultKey);

    const form = new FormData();
    form.append('image', new Blob([encImage], { type: 'application/octet-stream' }), `${img.hash}.enc`);
    const up = await cloudFetch(secrets, '/sync/upload-image', {
      method: 'PUT',
      headers: { 'X-PV-Hash': img.hash, 'X-PV-Meta': metaHeader(img) },
      body: form,
    });
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      throw new Error(`本体の送信に失敗（${up.status}）${t ? `: ${t.slice(0, 200)}` : ''}`);
    }
    const th = await cloudFetch(secrets, `/thumbs/${encodeURIComponent(img.hash)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: encThumb,
    });
    if (!th.ok) throw new Error(`サムネイルの送信に失敗（${th.status}）`);
  }

  const finish = (counts, errors, extra = {}) => {
    syncState = {
      state: 'idle',
      progress: null,
      lastRun: {
        finishedAt: new Date().toISOString(),
        uploaded: counts.uploaded,
        skipped: counts.skipped,
        failed: counts.failed,
        errors: errors.slice(0, ERRORS_KEPT),
        ...(errors.length > ERRORS_KEPT ? { errorsOmitted: errors.length - ERRORS_KEPT } : {}),
        ...extra,
      },
    };
  };

  async function runSync(secrets) {
    const counts = { uploaded: 0, skipped: 0, failed: 0 };
    const errors = [];
    try {
      // 手順1: 列挙
      const known = new Set(listTopFolders().map(t => t.name));
      const folders = readSelection().filter(f => {
        if (known.has(f)) return true;
        recordInvalid({ kind: 'sync-selected-folder-missing', stage: 'pv#115 sync.runSync', raw: f, reason: '保存済みの同期フォルダがギャラリーインデックスにない（今回は対象にしない）' });
        return false;
      });
      if (folders.length === 0) return finish(counts, errors);
      const vaultRoot = getVaultRoot();
      if (!vaultRoot || !existsSync(vaultRoot)) {
        recordInvalid({ kind: 'sync-vault-root-missing', stage: 'pv#115 sync.runSync', raw: vaultRoot ?? null, reason: 'VAULT_ROOT が未設定または存在しない（送信しない）' });
        throw Object.assign(new Error('VAULT_ROOT が未設定または存在しないため同期できません'), { fatal: true });
      }

      const local = listImagesIn(folders);
      const cloud = await fetchCloudInventory(secrets);
      const usage = await fetchR2Usage(secrets);
      const limit = r2LimitBytes();
      if (usage >= limit) {
        const msg = `R2 の使用量（${usage} B）が上限（${limit} B）に達しているため、今回は送信しません`;
        recordEvent({ code: 'SYNC_SKIPPED', level: 'warn', kind: 'sync-r2-limit-reached', stage: 'pv#115 sync.runSync', raw: { usage, limit }, reason: msg });
        errors.push(msg);
        return finish(counts, errors, { r2: { usage, limit } });
      }

      const uploaded = readUploaded();
      const targets = [];
      let deletedSkipped = 0;
      for (const img of local) {
        const inCloud = cloud.has(img.hash);
        if (inCloud && cloud.get(img.hash)) { deletedSkipped++; continue; } // クラウドで明示削除済みは復活させない
        if (inCloud && uploaded.has(img.hash)) { counts.skipped++; continue; }
        targets.push(img);
      }
      counts.skipped += deletedSkipped;

      // 手順2: 変換・暗号化・送信
      syncState.progress = { phase: 'uploading', current: 0, total: targets.length, currentFolder: '' };
      let sinceFlush = 0;
      for (const img of targets) {
        syncState.progress.current++;
        syncState.progress.currentFolder = img.folder.split('/')[0];
        try {
          await uploadOne(secrets, img);
          uploaded.add(img.hash);
          counts.uploaded++;
          if (++sinceFlush >= STATE_FLUSH_EVERY) { writeUploaded(uploaded); sinceFlush = 0; }
        } catch (e) {
          if (e.fatal) {
            counts.failed++;
            errors.push(`hash ${img.hash}: ${e.message}`);
            writeUploaded(uploaded);
            return finish(counts, errors, { aborted: true, deletedSkipped });
          }
          counts.failed++;
          errors.push(`hash ${img.hash}: ${e.message}`);
          recordEvent({ code: 'SYNC_FAILED', kind: 'sync-upload-failed', stage: 'pv#115 sync.uploadOne', raw: { hash: img.hash, folder: img.folder }, reason: e.message });
        }
      }

      // 手順3: 後片付け
      syncState.progress = { phase: 'cleanup', current: targets.length, total: targets.length, currentFolder: '' };
      writeUploaded(uploaded);
      return finish(counts, errors, { deletedSkipped });
    } catch (e) {
      errors.push(e.message);
      if (!e.fatal) recordEvent({ code: 'SYNC_FAILED', kind: 'sync-run-failed', stage: 'pv#115 sync.runSync', raw: e.stack || e.message, reason: e.message });
      return finish(counts, errors, { aborted: true });
    }
  }

  // 戻り値: { status, body }
  function startRun() {
    if (syncState.state === 'running') return { status: 409, body: { error: '同期が実行中です' } };
    const secrets = loadSyncSecrets({ env });
    if (!secrets.ok) return { status: 503, body: { error: `同期を開始できません: ${secrets.problems.join(' / ')}` } };
    syncState = { state: 'running', lastRun: syncState.lastRun, progress: { phase: 'scanning', current: 0, total: 0, currentFolder: '' } };
    runSync(secrets);
    return { status: 200, body: { started: true } };
  }

  const getStatus = () => syncState;
  const close = () => { if (db) { db.close(); db = null; } };

  return { getFolders, putFolders, startRun, getStatus, runSync, close, paths: { SYNC_PATH, STATE_PATH } };
}

// server.js の api ルーター（/api 配下）に載せる
export function setupSyncRoutes(api, opts) {
  const svc = createSyncService(opts);
  api.get('/sync/folders', (_req, res) => {
    try { res.json(svc.getFolders()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  api.put('/sync/folders', (req, res) => {
    try { const r = svc.putFolders(req.body); res.status(r.status).json(r.body); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  api.post('/sync/run', (_req, res) => {
    try { const r = svc.startRun(); res.status(r.status).json(r.body); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  api.get('/sync/status', (_req, res) => res.json(svc.getStatus()));
  return svc;
}
