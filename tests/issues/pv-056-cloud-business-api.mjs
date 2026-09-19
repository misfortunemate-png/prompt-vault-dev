import {
  mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, copyFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

class MemStore {
  constructor() { this._m = new Map(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { this._m.set(k, String(v)); }
  removeItem(k) { this._m.delete(k); }
  clear() { this._m.clear(); }
}

// connection.js constants (match src/lib/connection.js)
const CLOUD_URL = 'https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault';

export default {
  issue: 'pv#56',
  title: 'Cloud business API requests must use the canonical Cloud base URL',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-056-cloud-business-api.mjs',

  async verify() {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const tempRoot = mkdtempSync(join(repoRoot, '.phase6b-pv056-'));

    const oldStorage = globalThis.localStorage;
    const oldFetch = globalThis.fetch;
    const oldDoc = globalThis.document;

    try {
      globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'hidden' };
      const checks = [];

      // Set up isolated copies of connection.js + api.js so state doesn't bleed from other verifiers
      const srcDir = join(tempRoot, 'src');
      mkdirSync(srcDir, { recursive: true });
      copyFileSync(resolve(repoRoot, 'src', 'lib', 'connection.js'), join(srcDir, 'connection.js'));

      // Patch api.js: resolve connection.js import to tempdir copy, stub crypto
      let apiSrc = readFileSync(resolve(repoRoot, 'src', 'lib', 'api.js'), 'utf8');
      apiSrc = apiSrc.replace(
        "import { getConnection, resolveThumbUrl, captureConnectionSnapshot, isConnectionSnapshotCurrent } from './connection.js';",
        `import { getConnection, resolveThumbUrl, captureConnectionSnapshot, isConnectionSnapshotCurrent } from '${pathToFileURL(join(srcDir, 'connection.js')).href}';`,
      );
      apiSrc = apiSrc.replace(
        "import { decrypt } from './crypto.js';",
        "const decrypt = async (b) => b; // pv056 stub",
      );
      const apiPath = join(srcDir, 'api.js');
      writeFileSync(apiPath, apiSrc);

      const ts = Date.now();
      const connMod = await import(`${pathToFileURL(join(srcDir, 'connection.js')).href}?t=${ts}`);
      const { api } = await import(`${pathToFileURL(apiPath).href}?t=${ts}`);

      // ── AC-56-1 positive: Cloud route → business GETs use CLOUD_URL base ───────
      const captured = [];
      globalThis.localStorage = new MemStore();
      globalThis.fetch = async (url, opts) => {
        captured.push({ url, auth: opts?.headers?.Authorization });
        return { ok: true, status: 200, json: async () => ({}) };
      };

      connMod.saveConnection({
        route: 'cloud', manual: true, lastCheck: null,
        franUrl: connMod.FRAN_URL, cloudUrl: CLOUD_URL,
        token: 'test-token-56', revision: 'r1', cloudOfflineReason: null,
      });

      // Trigger two authenticated business GETs
      await api.getGallery().catch(() => {});
      await api.getPresets().catch(() => {});

      checks.push(check(
        'all business GET requests use canonical Cloud base URL',
        captured.length >= 2 && captured.every(r => r.url.startsWith(CLOUD_URL)),
        `requests=${captured.map(r => r.url).join(' | ')}`,
      ));

      // ── AC-56-2 positive: Cloud requests include Authorization header ──────────
      checks.push(check(
        'Cloud business requests carry Authorization header',
        captured.length >= 2 && captured.every(r => r.auth && r.auth.startsWith('Bearer ')),
        `auth_headers=${captured.map(r => r.auth).join(' | ')}`,
      ));

      // ── Negative control: patched api.js uses empty base → wrong URLs ──────────
      // Simulate old bug: base = '' for cloud route (requests sent without host)
      const negApiSrc = apiSrc.replace(
        "    base = conn.cloudUrl;",
        "    base = ''; // neg-ctrl: old bug — no base URL for cloud",
      );
      const negApiPath = join(srcDir, 'api-neg.js');
      writeFileSync(negApiPath, negApiSrc);
      const { api: apiNeg } = await import(`${pathToFileURL(negApiPath).href}?t=${ts + 1}`);

      const capturedNeg = [];
      globalThis.fetch = async (url, opts) => {
        capturedNeg.push({ url });
        return { ok: true, status: 200, json: async () => ({}) };
      };
      // localStorage still has route=cloud from above
      await apiNeg.getGallery().catch(() => {});
      await apiNeg.getPresets().catch(() => {});

      const negUrlsWrong = capturedNeg.length >= 1 && capturedNeg.some(r => !r.url.startsWith(CLOUD_URL));
      checks.push(check(
        'negative control: empty base causes requests to not use CLOUD_URL (old bug reproduced)',
        negUrlsWrong,
        `requests=${capturedNeg.map(r => r.url).join(' | ')}`,
      ));

      return checks;
    } finally {
      globalThis.localStorage = oldStorage;
      globalThis.fetch = oldFetch;
      globalThis.document = oldDoc;
      await new Promise(r => setTimeout(r, 100));
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  },
};
