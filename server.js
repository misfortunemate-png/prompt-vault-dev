import express from 'express';
import { createServer as createViteServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, unlinkSync, readdirSync, renameSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { getByHash, listFolders, listByFolder, getRecent, getRecentByDays, getStats, getAllPreviewHashes, setFavorite, getFavorites, search as dbSearch, getByPreset, setCaption, setCaptionConfig, deleteImage, getGalleryByCard, getTotalByCard } from './server/db.js';
import { startScan, getScanStatus } from './server/scanner.js';
import { executeGenerate, executeSave } from './server/generate.js';
import { getStatus as queueGetStatus, getTask as queueGetTask, addTasks, removeTask, clearQueue, startQueue, stopQueue } from './server/queue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --env-file 未使用時のフォールバック（node server.js 直接起動対策）
const _envPath = join(__dirname, '.env');
if (!process.env.VAULT_ROOT && existsSync(_envPath)) {
  for (const line of readFileSync(_envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const THUMBS_DIR = join(__dirname, 'data', 'thumbs');
const PORT = process.env.PORT || 8789;

mkdirSync(join(__dirname, 'data'), { recursive: true });
mkdirSync(join(__dirname, 'logs'), { recursive: true });

const SETTINGS_PATH  = join(__dirname, 'data', 'settings.json');
const CARDS_PATH     = join(__dirname, 'data', 'cards.json');
const PRESETS_DATA_PATH = join(__dirname, 'data', 'presets.json');

const DEFAULT_SETTINGS = {
  generation: {
    model: 'nai-diffusion-4-5-full',
    width: 832, height: 1216,
    steps: 28, sampler: 'k_euler_ancestral',
    scale: 5.0, seed: -1, maxResults: 5,
  },
  guard: { intervalMin: 2, intervalMax: 5, maxPerJob: 100 },
  captionStyle: { mode: 'margin', fontSize: 'medium', color: '#ffffff', outline: true },
  'sync.recent_days': 30,
  'sync.r2_limit_gb': 5,
};

// danbooru tags cache
let danbooruTags = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(prefix) {
  return prefix + randomBytes(4).toString('hex').slice(0, 5);
}

function readSettings() {
  if (!existsSync(SETTINGS_PATH)) writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
}

function readCardsData() {
  if (!existsSync(CARDS_PATH)) {
    const initial = createInitialCards();
    writeFileSync(CARDS_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(CARDS_PATH, 'utf8'));
}

function writeCardsData(data) {
  writeFileSync(CARDS_PATH, JSON.stringify(data, null, 2));
}

function readPresetsData() {
  if (!existsSync(PRESETS_DATA_PATH)) {
    const initial = { version: 1, presets: [] };
    writeFileSync(PRESETS_DATA_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(PRESETS_DATA_PATH, 'utf8'));
}

function writePresetsData(data) {
  writeFileSync(PRESETS_DATA_PATH, JSON.stringify(data, null, 2));
}

function createInitialCards() {
  return {
    version: 1,
    slots: [
      { id: generateId('s_'), name: 'キャラクター',   order: 0, useAsFolder: true,  useInFilename: false },
      { id: generateId('s_'), name: '衣装',           order: 1, useAsFolder: false, useInFilename: true  },
      { id: generateId('s_'), name: 'シチュエーション', order: 2, useAsFolder: false, useInFilename: false },
      { id: generateId('s_'), name: '構図・品質',      order: 3, useAsFolder: false, useInFilename: false },
      { id: generateId('s_'), name: '自由',            order: 4, useAsFolder: false, useInFilename: false },
    ],
    cards: [],
  };
}

function writeLog(level, code, message, detail) {
  const d = new Date();
  const entry = JSON.stringify({ ts: d.toISOString(), level, code, message, detail });
  appendFileSync(join(__dirname, 'logs', `${d.toISOString().slice(0, 10)}.log`), entry + '\n');
}

function loadDanbooruTags() {
  const csvPath = join(__dirname, 'docs', 'supplied', 'danbooru-filtered.csv');
  try {
    const content = readFileSync(csvPath, 'utf8');
    const tags = [];
    for (const line of content.trim().split('\n')) {
      const parts = line.split(',');
      if (parts.length >= 3 && parts[0]) {
        tags.push({ tag: parts[0].trim(), count: parseInt(parts[2]) || 0 });
      }
    }
    tags.sort((a, b) => b.count - a.count);
    danbooruTags = tags;
    console.log(`danbooruタグ読み込み完了: ${tags.length}件`);
  } catch (e) {
    console.warn('danbooru-filtered.csv 読み込み失敗:', e.message);
    writeLog('warn', 'DANBOORU_LOAD', 'danbooru-filtered.csv 読み込み失敗', e.message);
  }
}

// M2→M3 マイグレーション
function runMigration(vaultRoot) {
  const m2Path = join(vaultRoot, 'presets.json');
  const bakPath = join(vaultRoot, 'presets.json.bak');
  if (!existsSync(m2Path) || existsSync(CARDS_PATH)) return;

  console.log('[Migration] M2 presets.json → M3 cards.json を開始');
  let m2;
  try {
    m2 = JSON.parse(readFileSync(m2Path, 'utf8'));
  } catch (e) {
    console.warn('[Migration] presets.json 解析失敗:', e.message);
    return;
  }

  const cards = createInitialCards();
  const slotMap = {};
  for (const s of cards.slots) slotMap[s.name] = s.id;

  const addCards = (slotName, names) => {
    const slotId = slotMap[slotName];
    if (!slotId || !Array.isArray(names)) return;
    for (const name of names) {
      if (name && name.trim()) {
        cards.cards.push({ id: generateId('c_'), slotId, name: name.trim(), positive: '', negative: '' });
      }
    }
  };

  addCards('キャラクター', m2.characters);
  addCards('衣装', m2.outfits);
  addCards('シチュエーション', m2.situations);
  addCards('自由', m2.extras);

  const qualitySlotId = slotMap['構図・品質'];
  if (Array.isArray(m2.presets)) {
    for (const p of m2.presets) {
      cards.cards.push({
        id: generateId('c_'),
        slotId: qualitySlotId,
        name: p.name || '移行プリセット',
        positive: p.positive || '',
        negative: p.negative || '',
      });
    }
  }

  writeCardsData(cards);
  if (!existsSync(PRESETS_DATA_PATH)) writePresetsData({ version: 1, presets: [] });
  renameSync(m2Path, bakPath);

  console.log(`[Migration] 完了: スロット${cards.slots.length}件, カード${cards.cards.length}件。${m2Path} → .bak`);
}

function initVaultStructure() {
  const vaultRoot = process.env.VAULT_ROOT;
  if (vaultRoot) {
    try {
      mkdirSync(join(vaultRoot, '.tmp'), { recursive: true });
    } catch (e) {
      console.error('VAULT_ROOT .tmp 初期化エラー:', e.message);
    }
    runMigration(vaultRoot);
    setImmediate(() => startScan(vaultRoot));
  }
  // Ensure cards.json and presets.json exist
  readCardsData();
  readPresetsData();
}

function requireVaultRoot(req, res, next) {
  if (!process.env.VAULT_ROOT) return res.status(400).json({ error: 'VAULT_ROOT未設定' });
  next();
}

// ─── Server ────────────────────────────────────────────────────────────────

async function start() {
  loadDanbooruTags();
  initVaultStructure();

  const app = express();
  app.use(express.json());

  // M-4: CORS for cross-origin web front (GitHub Pages → Tailscale Express)
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  // Cloudflare Pages プレビューURL（ハッシュ付き）も許可
  const ALLOWED_ORIGIN_PATTERNS = [/^https:\/\/[a-z0-9]+-prompt-vault-6gr\.pages\.dev$/];
  function isAllowedOrigin(origin) {
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    return ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin));
  }
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });

  const api = express.Router();

  // ── System ──
  api.get('/healthz', (_req, res) => res.json({ status: 'ok', version: pkg.version }));

  api.get('/settings', (_req, res) => res.json(readSettings()));
  api.put('/settings', (req, res) => {
    writeFileSync(SETTINGS_PATH, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  });

  api.get('/system-info', (_req, res) => {
    const vaultRoot = process.env.VAULT_ROOT || '';
    const apiKey = process.env.NOVELAI_API_KEY || '';
    const novelaiToken = process.env.NOVELAI_TOKEN || '';
    res.json({
      vaultRoot: vaultRoot || null,
      vaultRootExists: vaultRoot ? existsSync(vaultRoot) : false,
      apiKey: apiKey ? apiKey.slice(0, 4) + '****' : null,
      novelaiToken: novelaiToken ? '設定済み' : null,
    });
  });

  // ── Cards/Slots ──

  api.get('/cards', (_req, res) => res.json(readCardsData()));

  api.put('/cards', (req, res) => {
    writeCardsData(req.body);
    res.json({ ok: true });
  });

  api.post('/cards/slot', (req, res) => {
    const data = readCardsData();
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'スロット名は必須です' });
    if (data.slots.some(s => s.name === name.trim())) return res.status(400).json({ error: '同名のスロットが既に存在します' });
    const slot = {
      id: generateId('s_'),
      name: name.trim(),
      order: data.slots.length,
      useAsFolder: false,
      useInFilename: false,
    };
    data.slots.push(slot);
    writeCardsData(data);
    res.json(slot);
  });

  api.put('/cards/slot/:id', (req, res) => {
    const data = readCardsData();
    const idx = data.slots.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'スロットが見つかりません' });
    const { name } = req.body;
    if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'スロット名は必須です' });
    if (name && name.trim() !== data.slots[idx].name && data.slots.some(s => s.name === name.trim())) {
      return res.status(400).json({ error: '同名のスロットが既に存在します' });
    }
    data.slots[idx] = { ...data.slots[idx], ...req.body };
    writeCardsData(data);
    res.json(data.slots[idx]);
  });

  api.delete('/cards/slot/:id', (req, res) => {
    const data = readCardsData();
    const idx = data.slots.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'スロットが見つかりません' });
    data.slots.splice(idx, 1);
    data.cards = data.cards.filter(c => c.slotId !== req.params.id);
    writeCardsData(data);
    res.json({ ok: true });
  });

  api.post('/cards/card', (req, res) => {
    const data = readCardsData();
    const { slotId, name, positive = '', negative = '', parentId = null } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'カード名は必須です' });
    if (!data.slots.some(s => s.id === slotId)) return res.status(400).json({ error: 'スロットが見つかりません' });
    if (data.cards.some(c => c.slotId === slotId && c.name === name.trim())) {
      return res.status(400).json({ error: '同じスロット内に同名カードが存在します' });
    }
    if (parentId) {
      const parent = data.cards.find(c => c.id === parentId);
      if (!parent) return res.status(400).json({ error: '親カードが見つかりません' });
      if (parent.slotId !== slotId) return res.status(400).json({ error: '親カードは同じスロット内である必要があります' });
    }
    const card = { id: generateId('c_'), slotId, name: name.trim(), positive, negative };
    if (parentId) card.parentId = parentId;
    data.cards.push(card);
    writeCardsData(data);
    res.json(card);
  });

  api.put('/cards/card/:id', (req, res) => {
    const data = readCardsData();
    const idx = data.cards.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'カードが見つかりません' });
    const { name, slotId } = req.body;
    if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'カード名は必須です' });
    const targetSlotId = slotId || data.cards[idx].slotId;
    const targetName = name?.trim() || data.cards[idx].name;
    if (data.cards.some((c, i) => i !== idx && c.slotId === targetSlotId && c.name === targetName)) {
      return res.status(400).json({ error: '同じスロット内に同名カードが存在します' });
    }
    const newParentId = req.body.parentId !== undefined ? req.body.parentId : data.cards[idx].parentId;
    if (newParentId) {
      const parent = data.cards.find(c => c.id === newParentId);
      if (!parent) return res.status(400).json({ error: '親カードが見つかりません' });
      if (parent.slotId !== targetSlotId) return res.status(400).json({ error: '親カードは同じスロット内である必要があります' });
    }
    data.cards[idx] = { ...data.cards[idx], ...req.body, name: targetName };
    writeCardsData(data);
    res.json(data.cards[idx]);
  });

  api.delete('/cards/card/:id', (req, res) => {
    const data = readCardsData();
    const cardId = req.params.id;
    if (!data.cards.some(c => c.id === cardId)) return res.status(404).json({ error: 'カードが見つかりません' });
    // Cascade: also delete children of this card
    data.cards = data.cards.filter(c => c.id !== cardId && c.parentId !== cardId);
    writeCardsData(data);
    res.json({ ok: true });
  });

  api.post('/cards/card/:id/duplicate', (req, res) => {
    const data = readCardsData();
    const src = data.cards.find(c => c.id === req.params.id);
    if (!src) return res.status(404).json({ error: 'カードが見つかりません' });
    const newCard = { ...src, id: generateId('c_'), name: src.name + ' のコピー' };
    data.cards.push(newCard);
    writeCardsData(data);
    res.json(newCard);
  });

  // ── Presets ── (tags before :id to avoid routing conflict)

  api.get('/presets/tags', (_req, res) => {
    const data = readPresetsData();
    const tagSet = new Set();
    for (const p of data.presets) for (const t of (p.tags || [])) tagSet.add(t);
    res.json([...tagSet].sort());
  });

  api.get('/presets', (_req, res) => res.json(readPresetsData()));

  api.post('/presets', (req, res) => {
    const data = readPresetsData();
    const { name, tags = [], cards = {} } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'プリセット名は必須です' });
    const preset = { id: generateId('p_'), name: name.trim(), tags, cards };
    data.presets.push(preset);
    writePresetsData(data);
    res.json(preset);
  });

  api.put('/presets', (req, res) => {
    writePresetsData(req.body);
    res.json({ ok: true });
  });

  api.put('/presets/:id', (req, res) => {
    const data = readPresetsData();
    const idx = data.presets.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'プリセットが見つかりません' });
    data.presets[idx] = { ...data.presets[idx], ...req.body };
    writePresetsData(data);
    res.json(data.presets[idx]);
  });

  api.delete('/presets/:id', (req, res) => {
    const data = readPresetsData();
    const idx = data.presets.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'プリセットが見つかりません' });
    data.presets.splice(idx, 1);
    writePresetsData(data);
    res.json({ ok: true });
  });

  api.post('/presets/:id/duplicate', (req, res) => {
    const data = readPresetsData();
    const src = data.presets.find(p => p.id === req.params.id);
    if (!src) return res.status(404).json({ error: 'プリセットが見つかりません' });
    const newPreset = { ...src, id: generateId('p_'), name: src.name + ' のコピー' };
    data.presets.push(newPreset);
    writePresetsData(data);
    res.json(newPreset);
  });

  // ── ギャラリー ──

  function buildFolderTree(rows, previewMap) {
    const folderCounts = {};
    for (const { folder, count } of rows) {
      if (!folder) continue;
      folderCounts[folder] = count;
      const parts = folder.split('/');
      for (let i = 1; i < parts.length; i++) {
        const p = parts.slice(0, i).join('/');
        if (!(p in folderCounts)) folderCounts[p] = 0;
      }
    }
    const nodeMap = {};
    const root = [];
    for (const path of Object.keys(folderCounts).sort()) {
      const parts = path.split('/');
      const node = {
        name: parts[parts.length - 1],
        path,
        imageCount: folderCounts[path],
        children: [],
        previewHashes: previewMap?.[path] ?? [],
      };
      nodeMap[path] = node;
      if (parts.length === 1) {
        root.push(node);
      } else {
        const parent = parts.slice(0, -1).join('/');
        (nodeMap[parent] ? nodeMap[parent].children : root).push(node);
      }
    }
    return root;
  }

  api.get('/gallery', (_req, res) => {
    try {
      const rows = listFolders();
      const previewMap = getAllPreviewHashes(4);
      const tree = buildFolderTree(rows, previewMap);
      const totalImages = rows.reduce((s, r) => s + r.count, 0);
      const totalFolders = rows.filter(r => r.folder).length;
      res.json({ tree, totalImages, totalFolders });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.get('/gallery/stats', (_req, res) => {
    try { res.json(getStats()); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/gallery/recent', (req, res) => {
    try {
      const days = parseInt(req.query.days) || 0;
      const limit = parseInt(req.query.limit) || 20;
      const rows = days > 0 ? getRecentByDays(days) : getRecent(limit);
      const images = rows.map(r => ({ ...r, thumbUrl: `/api/thumbs/${r.hash}.webp` }));
      res.json({ images });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.get('/gallery/folder', (req, res) => {
    const { path: folderPath = '' } = req.query;
    try {
      const images = listByFolder(folderPath).map(r => ({
        ...r,
        thumbUrl: `/api/thumbs/${r.hash}.webp`,
      }));
      const allFolders = listFolders();
      const prefix = folderPath ? folderPath + '/' : '';
      const subfolders = allFolders
        .filter(r => r.folder.startsWith(prefix) && r.folder !== folderPath)
        .map(r => ({ name: r.folder.slice(prefix.length).split('/')[0], path: r.folder }))
        .filter((v, i, a) => a.findIndex(x => x.name === v.name) === i);
      res.json({ path: folderPath, images, subfolders });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.get('/gallery/image/:hash', (req, res) => {
    try {
      const row = getByHash(req.params.hash);
      if (!row) return res.status(404).json({ error: '画像が見つかりません' });
      res.json(row);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── お気に入り・検索・プリセット別・セリフ ──

  api.put('/gallery/image/:hash/favorite', (req, res) => {
    try {
      const { favorite, meta_updated_at } = req.body;
      if (favorite !== 0 && favorite !== 1) return res.status(400).json({ error: 'favorite は 0 または 1' });
      setFavorite(req.params.hash, favorite, meta_updated_at || undefined);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/gallery/favorites', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const images = getFavorites(limit).map(r => ({ ...r, thumbUrl: `/api/thumbs/${r.hash}.webp` }));
      res.json({ images });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/gallery/search', (req, res) => {
    const { q, limit } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: '検索クエリが空です' });
    try {
      const images = dbSearch(q.trim(), parseInt(limit) || 50).map(r => ({ ...r, thumbUrl: `/api/thumbs/${r.hash}.webp` }));
      res.json({ images });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/gallery/by-preset/:presetId', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const images = getByPreset(req.params.presetId, limit).map(r => ({ ...r, thumbUrl: `/api/thumbs/${r.hash}.webp` }));
      res.json({ images });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.put('/gallery/image/:hash/caption', (req, res) => {
    try {
      const { caption, captionConfig, meta_updated_at } = req.body;
      if (typeof caption !== 'string') return res.status(400).json({ error: 'caption は文字列' });
      setCaption(req.params.hash, caption, meta_updated_at || undefined);
      if (captionConfig !== undefined) setCaptionConfig(req.params.hash, JSON.stringify(captionConfig));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/gallery/by-card', (req, res) => {
    try {
      const { positive, limit = 4 } = req.query;
      if (!positive) return res.json({ images: [], total: 0 });
      const images = getGalleryByCard(positive, parseInt(limit) || 4)
        .map(r => ({ ...r, thumbUrl: `/api/thumbs/${r.hash}.webp` }));
      const total = getTotalByCard(positive);
      res.json({ images, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.delete('/gallery/image/:hash', (req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    if (!vaultRoot) return res.status(400).json({ error: 'VAULT_ROOT未設定' });
    try {
      const relPath = deleteImage(req.params.hash);
      if (!relPath) return res.status(404).json({ error: '画像が見つかりません' });
      const filePath = join(vaultRoot, ...relPath.split('/'));
      if (existsSync(filePath)) unlinkSync(filePath);
      const thumbPath = join(__dirname, 'data', 'thumbs', `${req.params.hash}.webp`);
      if (existsSync(thumbPath)) unlinkSync(thumbPath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── リスキャン ──

  api.post('/rescan', (_req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    if (!vaultRoot) return res.status(400).json({ error: 'VAULT_ROOT未設定' });
    startScan(vaultRoot).catch(e => console.error('[Rescan]', e.message));
    res.json({ ok: true, scanning: true });
  });

  api.get('/rescan/status', (_req, res) => {
    res.json(getScanStatus());
  });

  // ── danbooruタグ ──

  api.get('/tags/search', (req, res) => {
    if (!danbooruTags) return res.json([]);
    const q = (req.query.q || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (q.length < 2) return res.json([]);
    const results = [];
    for (const { tag } of danbooruTags) {
      if (results.length >= 20) break;
      if (tag.toLowerCase().startsWith(q)) results.push(tag);
    }
    res.json(results);
  });

  // ── 生成 ──

  api.post('/generate', requireVaultRoot, async (req, res) => {
    const { prompt, negative_prompt, model, width, height, steps, scale, sampler, seed } = req.body;
    try {
      const result = await executeGenerate({
        prompt, negativePrompt: negative_prompt, model, width, height, steps, scale, sampler, seed,
        vaultRoot: process.env.VAULT_ROOT,
      });
      res.json({ success: true, image: result });
    } catch (e) {
      writeLog('error', 'GENERATE_FAILED', e.message, '');
      res.status(500).json({ error: e.message });
    }
  });

  // ── 保存（M3形式） ──

  api.post('/save', requireVaultRoot, (req, res) => {
    const { filename, seed, folderSegments = [], filenameSegments = [], preset_id } = req.body;
    try {
      const saved = executeSave(process.env.VAULT_ROOT, { filename, seed, folderSegments, filenameSegments, preset_id });
      res.json({ success: true, saved_path: saved.saved_path });
    } catch (e) {
      writeLog('error', 'SAVE_FAILED', e.message, '');
      res.status(500).json({ error: e.message });
    }
  });

  // ── 画像配信 ──

  // ── サムネイル ──

  api.get('/thumbs/:hash.webp', (req, res) => {
    const thumbPath = join(THUMBS_DIR, `${req.params.hash}.webp`);
    if (!existsSync(thumbPath)) return res.status(404).end();
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumbPath);
  });

  // ── 原寸画像（ハッシュベース） ──

  api.get('/images/full/:hash', requireVaultRoot, (req, res) => {
    const row = getByHash(req.params.hash);
    if (!row) return res.status(404).json({ error: '画像が見つかりません' });
    const filePath = join(process.env.VAULT_ROOT, row.rel_path);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'ファイルが見つかりません' });
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(filePath);
  });

  api.get('/images/.tmp/:filename', requireVaultRoot, (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '不正なパス' });
    }
    const filePath = join(process.env.VAULT_ROOT, '.tmp', filename);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'ファイルが見つかりません' });
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(filePath);
  });

  api.get('/images', requireVaultRoot, (_req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    if (!existsSync(vaultRoot)) return res.json({ folders: [], recent: [] });
    const entries = readdirSync(vaultRoot, { withFileTypes: true });
    const folders = [];
    const allImages = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.tmp') continue;
      const folderPath = join(vaultRoot, entry.name);
      const subEntries = readdirSync(folderPath, { withFileTypes: true });
      let count = 0;
      for (const sub of subEntries) {
        if (sub.isFile() && sub.name.endsWith('.png')) {
          count++;
          try {
            const st = statSync(join(folderPath, sub.name));
            allImages.push({ folder: entry.name, filename: sub.name, mtime: st.mtimeMs });
          } catch {}
        } else if (sub.isDirectory()) {
          // nested folder (e.g. オリジナル/キャラA)
          const nestedPath = join(folderPath, sub.name);
          try {
            for (const f of readdirSync(nestedPath)) {
              if (f.endsWith('.png')) {
                count++;
                const st = statSync(join(nestedPath, f));
                allImages.push({ folder: `${entry.name}/${sub.name}`, filename: f, mtime: st.mtimeMs });
              }
            }
          } catch {}
        }
      }
      if (count > 0) folders.push({ name: entry.name, count });
    }
    allImages.sort((a, b) => b.mtime - a.mtime);
    res.json({ folders, recent: allImages.slice(0, 8).map(({ folder, filename }) => ({ folder, filename })) });
  });

  api.get('/images/:folder', requireVaultRoot, (req, res) => {
    const { folder } = req.params;
    if (folder.includes('..') || folder === '.tmp') return res.status(400).json({ error: '不正なパス' });
    const folderPath = join(process.env.VAULT_ROOT, folder);
    if (!existsSync(folderPath)) return res.status(404).json({ error: 'フォルダが見つかりません' });
    const files = readdirSync(folderPath).filter(f => f.endsWith('.png')).sort();
    res.json({ folder, files });
  });

  api.get('/images/:folder/:filename', requireVaultRoot, (req, res) => {
    const { folder, filename } = req.params;
    if (folder.includes('..') || folder === '.tmp' || filename.includes('..')) {
      return res.status(400).json({ error: '不正なパス' });
    }
    const filePath = join(process.env.VAULT_ROOT, folder, filename);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'ファイルが見つかりません' });
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(filePath);
  });

  // ── デバッグ ──

  api.get('/debug/errors', (_req, res) => {
    const logFile = join(__dirname, 'logs', `${new Date().toISOString().slice(0, 10)}.log`);
    if (!existsSync(logFile)) return res.json([]);
    const lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    res.json(lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-20));
  });

  api.post('/debug/test-api', async (_req, res) => {
    const apiKey = process.env.NOVELAI_API_KEY;
    if (!apiKey) return res.json({ ok: false, error: 'APIキーが未設定です' });
    try {
      const resp = await fetch('https://image.api.novelai.net/ai/generate-image', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'test', model: 'nai-diffusion-4-curated-preview', action: 'generate', parameters: { width: 64, height: 64, steps: 1, sampler: 'k_euler', scale: 5.0, n_samples: 1, seed: 0 } }),
      });
      if (resp.ok) return res.json({ ok: true, message: 'NovelAI API 疎通OK' });
      const text = await resp.text();
      writeLog('error', 'API_AUTH_FAILED', `疎通テスト失敗: ${resp.status}`, text);
      res.json({ ok: false, error: `ステータス ${resp.status}: ${text.slice(0, 200)}` });
    } catch (e) {
      writeLog('error', 'API_NETWORK', 'NovelAI疎通テスト接続失敗', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  api.post('/debug/test-fs', (_req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    if (!vaultRoot) return res.json({ ok: false, error: 'VAULT_ROOTが未設定です' });
    const testFile = join(vaultRoot, '.pv-write-test');
    try {
      mkdirSync(vaultRoot, { recursive: true });
      writeFileSync(testFile, 'test');
      const content = readFileSync(testFile, 'utf8');
      unlinkSync(testFile);
      res.json(content === 'test' ? { ok: true, message: 'FS書込テスト成功' } : { ok: false, error: '読み取り内容が不一致' });
    } catch (e) {
      writeLog('error', 'FS_WRITE_FAILED', 'FS書込テスト失敗', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  api.post('/debug/reset', (_req, res) => {
    try {
      for (const f of readdirSync(join(__dirname, 'data'))) unlinkSync(join(__dirname, 'data', f));
      writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Queue (M5) ──

  api.get('/queue', (_req, res) => {
    res.json(queueGetStatus());
  });

  api.post('/queue/add', (req, res) => {
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'tasksは1件以上の配列が必要です' });
    }
    try {
      const added = addTasks(tasks);
      res.json({ success: true, added, total: queueGetStatus().tasks.length });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.delete('/queue/task/:id', (req, res) => {
    try {
      removeTask(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.delete('/queue/clear', (_req, res) => {
    try {
      clearQueue();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.post('/queue/start', (_req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    if (!vaultRoot) return res.status(400).json({ error: 'VAULT_ROOT未設定' });
    try {
      startQueue(vaultRoot);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.post('/queue/stop', (_req, res) => {
    try {
      stopQueue();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.post('/queue/task/:id/save', (req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    if (!vaultRoot) return res.status(400).json({ error: 'VAULT_ROOT未設定' });
    const task = queueGetTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'タスクが見つかりません' });
    if (task.status !== 'done') return res.status(400).json({ error: '完了タスクのみ保存できます' });
    if (task.saved) return res.status(400).json({ error: '既に保存済みです' });
    try {
      const saved = executeSave(vaultRoot, {
        filename: task.result.filename,
        seed: task.result.seed,
        folderSegments: task.folderSegments,
        filenameSegments: task.filenameSegments,
        preset_id: task.preset_id,
      });
      task.saved = true;
      res.json({ ok: true, saved_path: saved.saved_path });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use('/api', api);

  // Static assets
  for (const f of ['sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png']) {
    app.use(`/${f}`, (_req, res) => {
      if (f === 'sw.js') { res.setHeader('Content-Type', 'application/javascript'); res.setHeader('Service-Worker-Allowed', '/'); }
      res.sendFile(join(__dirname, 'public', f));
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(join(__dirname, 'dist')));
  }

  app.use((err, _req, res, _next) => {
    writeLog('error', 'UNHANDLED', err.message, err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  app.listen(PORT, () => console.log(`Prompt Vault v${pkg.version} listening on http://localhost:${PORT}/`));
}

start();
