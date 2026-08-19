import express from 'express';
import { createServer as createViteServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, unlinkSync, readdirSync, rmSync, renameSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { generate as novelaiGenerate } from './server/providers/novelai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const PORT = process.env.PORT || 8789;

mkdirSync(join(__dirname, 'data'), { recursive: true });
mkdirSync(join(__dirname, 'logs'), { recursive: true });

const DEFAULT_SETTINGS = {
  generation: {
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    sampler: 'k_euler_ancestral',
    scale: 5.0,
    seed: -1,
    maxResults: 5,
  },
  guard: {
    intervalMin: 2,
    intervalMax: 5,
    maxPerJob: 100,
  },
};

const DEFAULT_PRESETS = {
  presets: [
    {
      name: 'ポートレート標準',
      positive: 'portrait, upper body, looking at viewer, smile, best quality, very aesthetic',
      negative: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration',
    },
    {
      name: '全身立ち絵',
      positive: 'full body, standing, looking at viewer, best quality, very aesthetic',
      negative: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing',
    },
    {
      name: 'アップ寄り',
      positive: 'close-up, face, looking at viewer, detailed eyes, best quality, very aesthetic',
      negative: 'blurry, lowres, error, worst quality, bad quality, very displeasing',
    },
  ],
  characters: ['キャラA', 'キャラB', 'キャラC'],
  situations: ['放課後', '戦闘', '日常', '旅行'],
  outfits: ['制服', '私服', 'ドレス', '水着'],
  extras: ['雨', '夜景', '桜', '夕暮れ'],
};

const SETTINGS_PATH = join(__dirname, 'data', 'settings.json');

function readSettings() {
  if (!existsSync(SETTINGS_PATH)) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
  return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
}

function writeLog(level, code, message, detail) {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10);
  const entry = JSON.stringify({ ts: d.toISOString(), level, code, message, detail });
  appendFileSync(join(__dirname, 'logs', `${dateStr}.log`), entry + '\n');
}

function initVaultStructure() {
  const vaultRoot = process.env.VAULT_ROOT;
  if (!vaultRoot) return;
  try {
    mkdirSync(join(vaultRoot, '.tmp'), { recursive: true });
    const presetsPath = join(vaultRoot, 'presets.json');
    if (!existsSync(presetsPath)) {
      writeFileSync(presetsPath, JSON.stringify(DEFAULT_PRESETS, null, 2));
    }
  } catch (e) {
    console.error('VAULT_ROOT初期化エラー:', e.message);
  }
}

function requireVaultRoot(req, res, next) {
  if (!process.env.VAULT_ROOT) {
    return res.status(400).json({ error: 'VAULT_ROOT未設定' });
  }
  next();
}

async function start() {
  initVaultStructure();

  const app = express();
  app.use(express.json());

  const api = express.Router();

  api.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', version: pkg.version });
  });

  api.get('/settings', (_req, res) => {
    res.json(readSettings());
  });

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

  // --- プリセット ---

  api.get('/presets', requireVaultRoot, (_req, res) => {
    const presetsPath = join(process.env.VAULT_ROOT, 'presets.json');
    if (!existsSync(presetsPath)) {
      writeFileSync(presetsPath, JSON.stringify(DEFAULT_PRESETS, null, 2));
    }
    res.json(JSON.parse(readFileSync(presetsPath, 'utf8')));
  });

  // --- 生成 ---

  api.post('/generate', requireVaultRoot, async (req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    const { prompt, negative_prompt, model, width, height, steps, scale, sampler, seed } = req.body;
    try {
      const result = await novelaiGenerate({
        prompt: prompt || '',
        negativePrompt: negative_prompt || '',
        model: model || 'nai-diffusion-4-5-full',
        width: width || 832,
        height: height || 1216,
        steps: steps || 28,
        scale: scale || 5,
        sampler: sampler || 'k_euler_ancestral',
        seed: (seed != null && seed >= 0) ? seed : null,
        vaultRoot,
      });
      res.json({ success: true, image: result });
    } catch (e) {
      writeLog('error', 'GENERATE_FAILED', e.message, '');
      res.status(500).json({ error: e.message });
    }
  });

  // --- 保存 ---

  api.post('/save', requireVaultRoot, (req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    const { filename, character, outfit } = req.body;

    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '不正なファイル名です' });
    }

    const srcPath = join(vaultRoot, '.tmp', filename);
    if (!existsSync(srcPath)) {
      return res.status(404).json({ error: 'ファイルが見つかりません' });
    }

    const folder = (!character || character === '（なし）') ? 'その他' : character;
    const prefix = (!outfit || outfit === '（なし）') ? 'gen' : outfit;

    const now = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const yyyymmdd = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const hhmmss = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const hex = randomBytes(2).toString('hex');
    const newFilename = `${prefix}_${yyyymmdd}_${hhmmss}_${hex}.png`;

    const folderPath = join(vaultRoot, folder);
    mkdirSync(folderPath, { recursive: true });

    const destPath = join(folderPath, newFilename);
    try {
      renameSync(srcPath, destPath);
    } catch (e) {
      writeLog('error', 'SAVE_FAILED', e.message, '');
      return res.status(500).json({ error: e.message });
    }

    res.json({ success: true, saved_path: `${folder}/${newFilename}` });
  });

  // --- 画像配信 ---

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
      const files = readdirSync(folderPath).filter(f => f.endsWith('.png'));
      folders.push({ name: entry.name, count: files.length });
      for (const file of files) {
        try {
          const st = statSync(join(folderPath, file));
          allImages.push({ folder: entry.name, filename: file, mtime: st.mtimeMs });
        } catch {}
      }
    }

    allImages.sort((a, b) => b.mtime - a.mtime);
    const recent = allImages.slice(0, 8).map(({ folder, filename }) => ({ folder, filename }));

    res.json({ folders, recent });
  });

  api.get('/images/:folder', requireVaultRoot, (req, res) => {
    const { folder } = req.params;
    if (folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder === '.tmp') {
      return res.status(400).json({ error: '不正なパス' });
    }
    const folderPath = join(process.env.VAULT_ROOT, folder);
    if (!existsSync(folderPath)) return res.status(404).json({ error: 'フォルダが見つかりません' });
    const files = readdirSync(folderPath).filter(f => f.endsWith('.png')).sort();
    res.json({ folder, files });
  });

  api.get('/images/:folder/:filename', requireVaultRoot, (req, res) => {
    const { folder, filename } = req.params;
    if (folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder === '.tmp') {
      return res.status(400).json({ error: '不正なパス' });
    }
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '不正なパス' });
    }
    const filePath = join(process.env.VAULT_ROOT, folder, filename);
    if (!existsSync(filePath)) return res.status(404).json({ error: 'ファイルが見つかりません' });
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(filePath);
  });

  // --- デバッグ ---

  api.get('/debug/errors', (_req, res) => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const logFile = join(__dirname, 'logs', `${dateStr}.log`);
    if (!existsSync(logFile)) return res.json([]);
    const lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    res.json(entries.slice(-20));
  });

  api.post('/debug/test-api', async (_req, res) => {
    const apiKey = process.env.NOVELAI_API_KEY;
    if (!apiKey) {
      return res.json({ ok: false, error: 'APIキーが未設定です' });
    }
    try {
      const resp = await fetch('https://image.api.novelai.net/ai/generate-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: 'test',
          model: 'nai-diffusion-4-curated-preview',
          action: 'generate',
          parameters: { width: 64, height: 64, steps: 1, sampler: 'k_euler', scale: 5.0, n_samples: 1, seed: 0 },
        }),
      });
      if (resp.ok || resp.status === 200) {
        res.json({ ok: true, message: 'NovelAI API 疎通OK' });
      } else {
        const text = await resp.text();
        writeLog('error', 'API_AUTH_FAILED', `NovelAI疎通テスト失敗: ${resp.status}`, text);
        res.json({ ok: false, error: `ステータス ${resp.status}: ${text.slice(0, 200)}` });
      }
    } catch (e) {
      writeLog('error', 'API_NETWORK', 'NovelAI疎通テスト接続失敗', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  api.post('/debug/test-fs', (_req, res) => {
    const vaultRoot = process.env.VAULT_ROOT;
    if (!vaultRoot) {
      return res.json({ ok: false, error: 'VAULT_ROOTが未設定です' });
    }
    const testFile = join(vaultRoot, '.pv-write-test');
    try {
      mkdirSync(vaultRoot, { recursive: true });
      writeFileSync(testFile, 'test');
      const content = readFileSync(testFile, 'utf8');
      unlinkSync(testFile);
      if (content === 'test') {
        res.json({ ok: true, message: 'FS書込テスト成功' });
      } else {
        res.json({ ok: false, error: '読み取り内容が不一致' });
      }
    } catch (e) {
      writeLog('error', 'FS_WRITE_FAILED', 'FS書込テスト失敗', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  api.post('/debug/reset', (_req, res) => {
    try {
      const dataDir = join(__dirname, 'data');
      if (existsSync(dataDir)) {
        const files = readdirSync(dataDir);
        for (const f of files) {
          unlinkSync(join(dataDir, f));
        }
      }
      writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      res.json({ ok: true });
    } catch (e) {
      writeLog('error', 'FS_WRITE_FAILED', 'データリセット失敗', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.use('/api', api);

  app.use('/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(join(__dirname, 'public', 'sw.js'));
  });
  app.use('/manifest.json', (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'manifest.json'));
  });
  app.use('/icon-192.png', (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'icon-192.png'));
  });
  app.use('/icon-512.png', (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'icon-512.png'));
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(join(__dirname, 'dist')));
  }

  app.use((err, _req, res, _next) => {
    writeLog('error', 'UNHANDLED', err.message, err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  app.listen(PORT, () => {
    console.log(`Prompt Vault v${pkg.version} listening on http://localhost:${PORT}/`);
  });
}

start();
