// Fran（server.js）を一時ディレクトリの写しで起動する試験用ハーネス（pv#95 系 verifier 共用）
// - server.js・server/・package.json を repo 直下の一時ディレクトリへ写して起動する。
//   data/・logs/・index.db は写し側の __dirname 基準になるため、本物のデータには触れない
// - NovelAI は preload（--import）で globalThis.fetch を差し替えてモックする。実際には呼ばない
import {
  cpSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

// 他の verifier が globalThis.fetch を差し替えたまま戻さない場合があるため（pv-044 等）、読み込み時の fetch を保持して使う
const nativeFetch = globalThis.fetch;
const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..');

export function makeTempRoot(name) {
  return mkdtempSync(join(repoRoot, `.pv95-${name}-`));
}

export function removeTempRoot(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

// NovelAI モック。呼ばれた回数を calls ファイルに 1 行ずつ追記する。
// mode: ok（PNG を含む ZIP）／ status:<n>（その状態コード）／ html（2xx で HTML 本文）／ throw
const PRELOAD_SRC = `
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
const callsPath = process.env.PV_TEST_NAI_CALLS;
const modePath = process.env.PV_TEST_NAI_MODE_FILE;
const realFetch = globalThis.fetch;
function mode() { try { return existsSync(modePath) ? readFileSync(modePath, 'utf8').trim() : 'ok'; } catch { return 'ok'; } }
function zipWithPng() {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f20000000049454e44ae426082', 'hex');
  const name = Buffer.from('image_0.png');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0, 6); head.writeUInt16LE(0, 8);
  head.writeUInt32LE(png.length, 18); head.writeUInt32LE(png.length, 22); head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
  return Buffer.concat([head, name, png]);
}
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('image.novelai.net')) {
    let body = null; try { body = JSON.parse(init?.body ?? 'null'); } catch {}
    appendFileSync(callsPath, JSON.stringify({ url: u, model: body?.model, parameters: body?.parameters }) + '\\n');
    const m = mode();
    if (m === 'throw') throw new Error('mock network failure');
    if (m.startsWith('status:')) {
      const st = Number(m.slice(7));
      return new Response('mock error body ' + st, { status: st, headers: { 'Content-Type': 'text/plain' } });
    }
    if (m === 'html') return new Response('<!doctype html><html>maintenance</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    return new Response(zipWithPng(), { status: 200, headers: { 'Content-Type': 'application/x-zip-compressed' } });
  }
  return realFetch(url, init);
};
`;

// data: { 'settings.json': object|string, ... }（data/ に置く）
// files: { '相対パス': 内容 }（写しの直下に置く）／ vaultFiles: { '相対パス': 内容 }（VAULT_ROOT の下に置く）
export async function startFran({ name, data = {}, env = {}, dev = false, envFile = null, files = {}, vaultFiles = {} } = {}) {
  const root = makeTempRoot(name);
  copyFileSync(join(repoRoot, 'server.js'), join(root, 'server.js'));
  cpSync(join(repoRoot, 'server'), join(root, 'server'), { recursive: true });
  copyFileSync(join(repoRoot, 'package.json'), join(root, 'package.json'));
  mkdirSync(join(root, 'data'), { recursive: true });
  for (const [file, content] of Object.entries(data)) {
    writeFileSync(join(root, 'data', file), typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
  }
  if (envFile != null) writeFileSync(join(root, '.env'), envFile);
  const vault = join(root, 'vault');
  mkdirSync(join(vault, '.tmp'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  for (const [rel, content] of Object.entries(vaultFiles)) {
    mkdirSync(dirname(join(vault, rel)), { recursive: true });
    writeFileSync(join(vault, rel), content);
  }
  const callsPath = join(root, 'nai-calls.jsonl');
  const modePath = join(root, 'nai-mode.txt');
  writeFileSync(callsPath, '');
  const preloadPath = join(root, 'nai-mock.mjs');
  writeFileSync(preloadPath, PRELOAD_SRC);

  const port = await freePort();
  const childEnv = { ...process.env };
  for (const k of ['VAULT_ROOT', 'NOVELAI_API_KEY', 'NOVELAI_TOKEN', 'ALLOWED_ORIGINS', 'NODE_ENV', 'PORT']) delete childEnv[k];
  Object.assign(childEnv, {
    PORT: String(port),
    VAULT_ROOT: vault,
    NOVELAI_TOKEN: 'test-novelai-token',
    PV_TEST_NAI_CALLS: callsPath,
    PV_TEST_NAI_MODE_FILE: modePath,
  }, dev ? {} : { NODE_ENV: 'production' }, env);
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k];

  const child = spawn(process.execPath, ['--import', pathToFileURL(preloadPath).href, join(root, 'server.js')], {
    cwd: repoRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  let exited = null;
  const exitPromise = new Promise(r => child.on('exit', (code) => { exited = code; r(code); }));

  const base = `http://127.0.0.1:${port}/api`;
  const deadline = Date.now() + 40000;
  let up = false;
  while (Date.now() < deadline && exited === null) {
    try {
      const r = await nativeFetch(base + '/healthz');
      if (r.ok) { up = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  const h = {
    root, vault, base, port, dataDir: join(root, 'data'), logDir: join(root, 'logs'),
    get output() { return output; },
    get exited() { return exited; },
    up,
    setNovelAiMode(m) { writeFileSync(modePath, m); },
    novelAiCalls() {
      return readFileSync(callsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    },
    logEntries() {
      if (!existsSync(h.logDir)) return [];
      const out = [];
      for (const f of readdirSync(h.logDir).sort()) {
        for (const line of readFileSync(join(h.logDir, f), 'utf8').split('\n').filter(Boolean)) {
          try { out.push(JSON.parse(line)); } catch { out.push({ unparseable: line }); }
        }
      }
      return out;
    },
    invalidEntries() { return h.logEntries().filter(e => e.code === 'INVALID'); },
    async req(method, path, body, headers = {}) {
      const init = { method, headers: { ...headers } };
      if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!Object.keys(init.headers).some(k => k.toLowerCase() === 'content-type')) init.headers['Content-Type'] = 'application/json';
      }
      const r = await nativeFetch(base + path, init);
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: r.status, text, json, contentType: r.headers.get('content-type') || '' };
    },
    async stop({ keep = false } = {}) {
      if (exited === null) {
        child.kill();
        await Promise.race([exitPromise, new Promise(r => setTimeout(r, 5000))]);
      }
      await new Promise(r => setTimeout(r, 150));
      if (!keep) removeTempRoot(root);
    },
  };
  return h;
}

// 起動するだけ（起動を止めるべき値の試験用）。終了コードと出力を返す
export async function runFranUntilExit({ name, env = {}, envFile = null, timeoutMs = 15000 }) {
  const h = await startFran({ name, env, envFile });
  const started = h.up;
  const deadline = Date.now() + (started ? 0 : timeoutMs);
  while (h.exited === null && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  const result = { started, exited: h.exited, output: h.output, invalid: h.invalidEntries() };
  await h.stop();
  return result;
}
