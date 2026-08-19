import express from 'express';
import { createServer as createViteServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, unlinkSync, readdirSync, renameSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { generate as novelaiGenerate } from './server/providers/novelai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
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

function sanitizeSegment(s) {
  let c = String(s).replace(/[\/\\:*?"<>|]/g, '_').trim();
  if (c === '..' || c === '.') c = 'unnamed';
  return c || 'unnamed';
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
    const { slotId, name, positive = '', negative = '' } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'カード名は必須です' });
    if (!data.slots.some(s => s.id === slotId)) return res.status(400).json({ error: 'スロットが見つかりません' });
    if (data.cards.some(c => c.slotId === slotId && c.name === name.trim())) {
      return res.status(400).json({ error: '同じスロット内に同名カードが存在します' });
    }
    const card = { id: generateId('c_'), slotId, name: name.trim(), positive, negative };
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
    data.cards[idx] = { ...data.cards[idx], ...req.body, name: targetName };
    writeCardsData(data);
    res.json(data.cards[idx]);
  });

  api.delete('/cards/card/:id', (req, res) => {
    const data = readCardsData();
    const idx = data.cards.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'カードが見つかりません' });
    data.cards.splice(idx, 1);
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
      const result = await novelaiGenerate({
        prompt: prompt || '', negativePrompt: negative_prompt || '',
        model: model || 'nai-diffusion-4-5-full',
        width: width || 832, height: height || 1216,
        steps: steps || 28, scale: scale || 5,
        sampler: sampler || 'k_euler_ancestral',
        seed: (seed != null && seed >= 0) ? seed : null,
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
    const vaultRoot = process.env.VAULT_ROOT;
    const { filename, seed, folderSegments = [], filenameSegments = [] } = req.body;

    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '不正なファイル名です' });
    }
    const srcPath = join(vaultRoot, '.tmp', filename);
    if (!existsSync(srcPath)) return res.status(404).json({ error: 'ファイルが見つかりません' });

    const validFolders = folderSegments.filter(s => s && s !== '（なし）').map(sanitizeSegment);
    const folderPath = validFolders.length > 0 ? validFolders.join('/') : 'その他';

    const validNames = filenameSegments.filter(s => s && s !== '（なし）').map(sanitizeSegment);
    const prefix = validNames.length > 0 ? validNames.join('_') : 'gen';
    const seedStr = String(seed ?? 0).padStart(10, '0');
    const newFilename = `${prefix}_${seedStr}.png`;

    const destDir = join(vaultRoot, ...folderPath.split('/'));
    mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, newFilename);

    try {
      renameSync(srcPath, destPath);
    } catch (e) {
      writeLog('error', 'SAVE_FAILED', e.message, '');
      return res.status(500).json({ error: e.message });
    }
    res.json({ success: true, saved_path: `${folderPath}/${newFilename}` });
  });

  // ── 画像配信 ──

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
