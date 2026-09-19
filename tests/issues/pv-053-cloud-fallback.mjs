import {
  mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync,
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

// Build a URL-routing fetch mock based on scenario spec
function makeFetch(spec) {
  // spec: array of { match: fn(url) => bool, ok, status, throws }
  // First matching spec wins
  return async (url, _opts) => {
    for (const s of spec) {
      if (s.match(url)) {
        if (s.throws) throw new Error(s.throws);
        return { ok: s.ok ?? (s.status >= 200 && s.status < 300), status: s.status ?? (s.ok ? 200 : 500) };
      }
    }
    throw new Error('unexpected URL: ' + url);
  };
}

export default {
  issue: 'pv#53',
  title: 'Fran offline must fall through to Cloud probe, not immediately go offline',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-053-cloud-fallback.mjs',

  async verify() {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const tempRoot = mkdtempSync(join(repoRoot, '.phase6b-pv053-'));

    const oldDoc = globalThis.document;
    const oldFetch = globalThis.fetch;
    const oldStorage = globalThis.localStorage;

    try {
      globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'hidden' };

      // Read connection.js source once for patching
      const connSrc = readFileSync(resolve(repoRoot, 'src', 'lib', 'connection.js'), 'utf8');

      const ts = Date.now();
      const srcDir = join(tempRoot, 'src');
      mkdirSync(srcDir, { recursive: true });

      // Write a copy for the negative control: skip Cloud probe when Fran fails
      const negConnSrc = connSrc.replace(
        "  const cloudHealthOk = await fetchReachable(CLOUD_URL + '/healthz', timeoutMs);",
        "  // [neg-ctrl] Cloud fallback bypassed — old bug\n  return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason: null });\n  // eslint-disable-next-line no-unreachable\n  const cloudHealthOk = await fetchReachable(CLOUD_URL + '/healthz', timeoutMs);",
      );
      const negConnPath = join(srcDir, 'connection-neg.mjs');
      writeFileSync(negConnPath, negConnSrc);

      const checks = [];

      // Helper: fresh storage + import for each scenario
      async function runScenario(connModUrl, baseState, fetchSpec) {
        globalThis.localStorage = new MemStore();
        globalThis.localStorage.setItem('pv-connection', JSON.stringify(baseState));
        globalThis.fetch = makeFetch(fetchSpec);
        const mod = await import(`${connModUrl}?t=${ts}_${Math.random()}`);
        return mod.checkReachability();
      }

      const FRAN_URL = 'https://fraine.tail204746.ts.net:8445/api';
      const CLOUD_URL = 'https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault';

      const BASE = {
        route: 'offline', manual: false, lastCheck: null,
        franUrl: FRAN_URL, cloudUrl: CLOUD_URL,
        token: 'test-token-53', revision: 'r0', cloudOfflineReason: null,
      };

      const connModUrl = pathToFileURL(resolve(repoRoot, 'src', 'lib', 'connection.js')).href;

      // ── AC-53-1: Fran network failure → Cloud succeeds → route=cloud ──────────
      {
        const result = await runScenario(connModUrl, BASE, [
          { match: u => u.includes('fraine'), throws: 'ECONNREFUSED' },
          { match: u => u.includes('/healthz'), ok: true, status: 200 },
          { match: u => u.includes('/settings'), ok: true, status: 200 },
        ]);
        checks.push(check(
          'Fran network failure falls through to Cloud and sets route=cloud',
          result.route === 'cloud',
          `route=${result.route} cloudOfflineReason=${result.cloudOfflineReason}`,
        ));
        checks.push(check(
          'Cloud fallback does not require Fran to succeed first',
          result.route !== 'offline',
          `route=${result.route}`,
        ));
      }

      // ── AC-53-2: Fran fails, Cloud healthz ok but auth 401 → offline with diagnostic
      {
        const result = await runScenario(connModUrl, BASE, [
          { match: u => u.includes('fraine'), throws: 'ECONNREFUSED' },
          { match: u => u.includes('/healthz'), ok: true, status: 200 },
          { match: u => u.includes('/settings'), ok: false, status: 401 },
        ]);
        checks.push(check(
          'Fran network failure + Cloud 401: cloudOfflineReason=auth-failed (not generic)',
          result.cloudOfflineReason === 'auth-failed',
          `cloudOfflineReason=${result.cloudOfflineReason} route=${result.route}`,
        ));
      }

      // ── AC-53-3: Both Fran and Cloud network failure → offline, distinguishable ─
      {
        const result = await runScenario(connModUrl, BASE, [
          { match: () => true, throws: 'ECONNREFUSED' },
        ]);
        checks.push(check(
          'Both backends network failure: cloudOfflineReason is not auth-failed (distinguishable)',
          result.route === 'offline' && result.cloudOfflineReason !== 'auth-failed',
          `route=${result.route} cloudOfflineReason=${result.cloudOfflineReason}`,
        ));
      }

      // ── Negative control: patched module skips Cloud probe ────────────────────
      {
        const negConnUrl = pathToFileURL(negConnPath).href;
        const result = await runScenario(negConnUrl, BASE, [
          { match: u => u.includes('fraine'), throws: 'ECONNREFUSED' },
          // Cloud probes would succeed, but they're never reached in buggy version
          { match: u => u.includes('/healthz'), ok: true, status: 200 },
          { match: u => u.includes('/settings'), ok: true, status: 200 },
        ]);
        checks.push(check(
          'negative control: bypassed Cloud probe causes offline instead of cloud (old bug reproduced)',
          result.route === 'offline',
          `route=${result.route} (expected offline because Cloud probe was bypassed)`,
        ));
      }

      return checks;
    } finally {
      globalThis.document = oldDoc;
      globalThis.fetch = oldFetch;
      globalThis.localStorage = oldStorage;
      await new Promise(r => setTimeout(r, 100));
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  },
};
