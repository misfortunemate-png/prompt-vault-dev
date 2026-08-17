import express from 'express';
import { createServer as createViteServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, unlinkSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const PORT = process.env.PORT || 8789;

mkdirSync(join(__dirname, 'data'), { recursive: true });
mkdirSync(join(__dirname, 'logs'), { recursive: true });

const DEFAULT_SETTINGS = {
  generation: {
    model: 'nai-diffusion-4-curated-preview',
    width: 832,
    height: 1216,
    steps: 28,
    sampler: 'k_euler',
    scale: 5.0,
    seed: -1,
  },
  guard: {
    intervalMin: 2,
    intervalMax: 5,
    maxPerJob: 100,
  },
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

async function start() {
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
    res.json({
      vaultRoot: vaultRoot || null,
      vaultRootExists: vaultRoot ? existsSync(vaultRoot) : false,
      apiKey: apiKey ? apiKey.slice(0, 4) + '****' : null,
    });
  });

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

  app.use('/vault/api', api);

  app.use('/vault/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/vault/');
    res.sendFile(join(__dirname, 'public', 'sw.js'));
  });
  app.use('/vault/manifest.json', (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'manifest.json'));
  });
  app.use('/vault/icon-192.png', (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'icon-192.png'));
  });
  app.use('/vault/icon-512.png', (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'icon-512.png'));
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use('/vault', express.static(join(__dirname, 'dist')));
  }

  app.use((err, _req, res, _next) => {
    writeLog('error', 'UNHANDLED', err.message, err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  app.listen(PORT, () => {
    console.log(`Prompt Vault v${pkg.version} listening on http://localhost:${PORT}/vault/`);
  });
}

start();
