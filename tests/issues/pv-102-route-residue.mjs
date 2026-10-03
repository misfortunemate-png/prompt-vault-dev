// pv#102: 接続経路・応答の振り分けに残余の型を持たせる（J-11〜J-14）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFran, repoRoot } from './lib/fran-harness.mjs';
import { MemStore, freshImport, withGlobals, check } from './lib/front-env.mjs';

const settle = () => new Promise(r => setTimeout(r, 80)); // 動的 import による記録を待つ
const SECRET = 'SECRET-TOKEN-VALUE-102';
const FRAN = 'https://fraine.tail204746.ts.net:8445/api';
const CLOUD = 'https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault';
const doc = { addEventListener() {}, removeEventListener() {}, visibilityState: 'hidden' };
const base = (o = {}) => JSON.stringify({ route: 'offline', manual: false, lastCheck: null, franUrl: FRAN, cloudUrl: CLOUD, token: SECRET, revision: 'r1', cloudOfflineReason: null, ...o });

function routedFetch(spec) {
  return async (url, init) => {
    for (const [match, resp] of spec) {
      if (url.includes(match)) {
        if (resp === 'throw') throw new Error('ECONNREFUSED');
        // 応答しない相手。実際の fetch と同じく abort で reject する
        if (resp === 'hang') {
          return new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
          });
        }
        return { ok: resp >= 200 && resp < 300, status: resp, json: async () => ({}) };
      }
    }
    throw new Error('unexpected URL ' + url);
  };
}

export default {
  issue: 'pv#102',
  title: 'Route and response classification has a residue type; unknown routes go offline in one place',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-102-route-residue.mjs',

  async verify() {
    const checks = [];

    // ── F-01・F-02・J-11: 保存された接続設定 ──
    for (const [label, stored, expect] of [
      ['unparseable pv-connection', `{"token":"${SECRET}",`, (c, log) => c.route === 'offline' && log.some(e => e.kind === 'connection-state-unparseable')],
      ['unknown route', base({ route: 'satellite' }), (c, log) => c.route === 'offline' && log.some(e => e.raw.includes('satellite'))],
      ['token not a string', base({ token: 12345 }), (c, log) => c.token === '' && log.some(e => /token/.test(e.kind))],
      ['unknown cloudOfflineReason', base({ cloudOfflineReason: 'weird' }), (c, log) => c.cloudOfflineReason === null && log.some(e => e.raw.includes('weird'))],
    ]) {
      const store = new MemStore({ 'pv-connection': stored });
      await withGlobals({ localStorage: store, document: doc }, async () => {
        const log = await freshImport('src/lib/invalidLog.js');
        const conn = await freshImport('src/lib/connection.js');
        const c1 = conn.getConnection();
        conn.getConnection();
        conn.getConnection();
        await settle();
        const entries = log.getInvalidLog();
        checks.push(check(`AC-11 F-01/F-02 ${label}: handled and recorded`, expect(c1, entries), `conn=${JSON.stringify({ route: c1.route, reason: c1.cloudOfflineReason, tokenType: typeof c1.token })} log=${JSON.stringify(entries).slice(0, 300)}`));
        checks.push(check(`AC-11 F-01/F-02 ${label}: recorded once (not on every read)`, entries.length === 1 && (entries[0].count ?? 1) === 1, JSON.stringify(entries).slice(0, 300)));
        checks.push(check(`AC-11 J-3 ${label}: the token value is not in the aggregator`, !JSON.stringify(entries).includes(SECRET), 'token leaked'));
      });
    }
    // J-11: 寄せ先は一つ（どの読み手も offline を見る）
    {
      const store = new MemStore({ 'pv-connection': base({ route: 'satellite' }) });
      await withGlobals({ localStorage: store, document: doc }, async () => {
        const conn = await freshImport('src/lib/connection.js');
        const views = [conn.getConnection().route, conn.captureConnectionSnapshot().route, JSON.parse(store.getItem('pv-connection')).route];
        checks.push(check('AC-11 J-11: an unknown route resolves to offline in one place (getConnection, snapshot, stored value)',
          views.every(v => v === 'offline'), JSON.stringify(views)));
      });
    }
    const src = (p) => readFileSync(join(repoRoot, p), 'utf8');
    const header = src('src/components/Header.jsx');
    checks.push(check('AC-11 J-11: no other module re-folds an unknown route (connection.js holds the only ROUTES list)',
      /const ROUTES = \['fran', 'cloud', 'offline'\]/.test(src('src/lib/connection.js')) && !/ROUTES/.test(header), 'ROUTES list missing in connection.js'));

    // ── F-03: 到達確認のタイムアウト値 ──
    for (const [label, stored] of [['non-numeric', 'abc'], ['zero', '0'], ['negative', '-5']]) {
      const store = new MemStore({ 'pv-connection': base(), 'pv-connection-timeout': stored });
      await withGlobals({ localStorage: store, document: doc }, async () => {
        const log = await freshImport('src/lib/invalidLog.js');
        const conn = await freshImport('src/lib/connection.js');
        const v = conn.getTimeoutSetting();
        await settle();
        checks.push(check(`AC-11 F-03 stored timeout ${label}: not passed through; recorded with the raw value`,
          Number.isInteger(v) && v >= 500 && log.getInvalidLog().some(e => e.raw.includes(stored)), `value=${v} log=${JSON.stringify(log.getInvalidLog()).slice(0, 200)}`));
      });
    }
    {
      const store = new MemStore({ 'pv-connection': base(), 'pv-connection-timeout': '8000' });
      await withGlobals({ localStorage: store, document: doc }, async () => {
        const log = await freshImport('src/lib/invalidLog.js');
        const conn = await freshImport('src/lib/connection.js');
        conn.updateSettings({ timeoutMs: 0 });
        await settle();
        const kept = store.getItem('pv-connection-timeout');
        checks.push(check('AC-11 F-03 updateSettings(timeoutMs: 0) does not store 0 and is recorded', kept === '8000' && log.getInvalidLog().length > 0, `stored=${kept}`));
        conn.updateSettings({ timeoutMs: 5000 });
        checks.push(check('AC-11 F-03 control: a valid timeout is stored', store.getItem('pv-connection-timeout') === '5000', `stored=${store.getItem('pv-connection-timeout')}`));
      });
    }

    // ── F-04・J-12: 到達確認の結果 ──
    const probeCase = async (label, spec, expectFn, timeout = '500') => {
      const store = new MemStore({ 'pv-connection': base(), 'pv-connection-timeout': timeout });
      await withGlobals({ localStorage: store, document: doc, fetch: routedFetch(spec) }, async () => {
        const log = await freshImport('src/lib/invalidLog.js');
        const conn = await freshImport('src/lib/connection.js');
        const r = await conn.checkReachability();
        await settle();
        const entries = log.getInvalidLog();
        checks.push(check(`AC-11 F-04 ${label}`, expectFn(r, entries), `route=${r.route} reason=${r.cloudOfflineReason} log=${JSON.stringify(entries).slice(0, 300)}`));
      });
    };
    await probeCase('Cloud /healthz 401 → auth-failed', [['fraine', 'throw'], ['/healthz', 401]], (r) => r.route === 'offline' && r.cloudOfflineReason === 'auth-failed');
    await probeCase('Cloud /healthz 403 → auth-failed', [['fraine', 'throw'], ['/healthz', 403]], (r) => r.cloudOfflineReason === 'auth-failed');
    await probeCase('Fran network failure: reason recorded', [['fraine', 'throw'], ['/healthz', 'throw']], (r, e) => e.some(x => /fran/i.test(x.kind) && /network|通信/.test(x.raw + x.reason)));
    await probeCase('Fran non-2xx: status recorded', [['fraine', 503], ['/healthz', 'throw']], (r, e) => e.some(x => /fran/i.test(x.kind) && x.raw.includes('503')));
    await probeCase('Fran timeout: reason recorded', [['fraine', 'hang'], ['/healthz', 'throw']], (r, e) => e.some(x => /fran/i.test(x.kind) && /timeout|タイムアウト/.test(x.raw + x.reason)));
    await probeCase('Cloud /settings 503: cloud-error with the status recorded', [['fraine', 'throw'], ['/healthz', 200], ['/settings', 503]], (r, e) => r.cloudOfflineReason === 'cloud-error' && e.some(x => x.raw.includes('503')));
    await probeCase('control: Cloud ok → cloud', [['fraine', 'throw'], ['/healthz', 200], ['/settings', 200]], (r) => r.route === 'cloud');

    // ── F-05: 業務 API の応答 ──
    {
      const store = new MemStore({ 'pv-connection': base({ route: 'fran', manual: true }) });
      const fetch = async () => ({
        ok: true, status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
        clone() { return { text: async () => '<!doctype html><title>spa</title>' }; },
        json: async () => { throw new SyntaxError("Unexpected token '<'"); },
      });
      await withGlobals({ localStorage: store, document: doc, fetch }, async () => {
        const log = await freshImport('src/lib/invalidLog.js');
        const { api } = await freshImport('src/lib/api.js');
        let err = null;
        try { await api.getCards(); } catch (e) { err = e; }
        await settle();
        const rec = log.getInvalidLog().find(e => /F-05/.test(e.stage));
        checks.push(check('AC-11 F-05: a 2xx non-JSON body raises an error carrying path/route/status', !!err && /\/cards/.test(err.message) && /Fran/.test(err.message) && /200/.test(err.message), err?.message));
        checks.push(check('AC-11 F-05: recorded with Content-Type and the head of the body', !!rec && rec.raw.includes('text/html') && rec.raw.includes('doctype'), JSON.stringify(rec)));
      });
    }

    // ── F-06・F-07・F-10・F-11（画面の振り分け: 静的） ──
    const gen = src('src/screens/GenerateScreen.jsx');
    const fti = (gen.match(/async function fetchTaskImage[\s\S]*?\n\}/) || [''])[0];
    checks.push(check('AC-11 F-06: fetchTaskImage records non-2xx/non-404 and does not return a silent empty result',
      /status === 404/.test(fti) && /recordInvalid/.test(fti) && !/if \(!r\.ok\) return \{ expired: false, plain: null \};/.test(fti), fti.slice(0, 400)));
    const toast = src('src/components/Toast.jsx');
    checks.push(check('AC-11 F-07: warn and warning are defined toast types (J-2)', /\bwarn:/.test(toast) && /\bwarning:/.test(toast), 'warn/warning styles missing'));
    checks.push(check('AC-11 F-07: an unknown toast type is recorded', /recordInvalid/.test(toast) && /F-07/.test(toast), 'unknown toast type not recorded'));
    checks.push(check('AC-11 F-10: restored model/sampler/resolution outside the lists are recorded and shown as-is',
      /F-10/.test(gen) && /一覧にない値/.test(gen), 'F-10 handling missing'));
    checks.push(check('AC-11 F-10: an unparseable seed is not folded into random', /F-10[^\n]*seed|seed[^\n]*F-10/.test(gen) || /parseSeed/.test(gen), 'seed NaN handling missing'));
    const settings = src('src/screens/SettingsScreen.jsx');
    checks.push(check('AC-11 F-11 (J-14): a saved model not in the list is shown as-is and recorded', /F-11/.test(settings) && /一覧にない値/.test(settings), 'F-11 handling missing'));

    // ── AC-12: S-14・S-15（Fran・dev 起動 = Vite の SPA フォールバックあり） ──
    const fran = await startFran({ name: 'pv102', dev: true });
    try {
      checks.push(check('Fran test instance (dev/Vite) starts', fran.up, fran.output.slice(-600)));
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const n0 = fran.invalidEntries().length;
        const r = await fran.req(method, '/no-such-endpoint-102', method === 'GET' || method === 'DELETE' ? undefined : {}, { Accept: '*/*' });
        const inv = fran.invalidEntries().slice(n0);
        checks.push(check(`AC-12 S-14 ${method} undefined /api/*: JSON 404 and recorded`,
          r.status === 404 && /json/.test(r.contentType) && inv.some(e => e.raw.includes('/no-such-endpoint-102')), `status=${r.status} type=${r.contentType} body=${r.text.slice(0, 120)}`));
      }
      const ok = await fran.req('GET', '/healthz');
      checks.push(check('AC-12 S-14 control: defined /api/healthz still 200', ok.status === 200, `status=${ok.status}`));
      const n0 = fran.invalidEntries().length;
      const bad = await fran.req('GET', '/healthz', undefined, { Origin: 'https://evil.example' });
      const inv = fran.invalidEntries().slice(n0);
      checks.push(check('AC-12 S-15: a disallowed Origin is recorded on the server', inv.some(e => e.raw.includes('https://evil.example')), JSON.stringify(inv).slice(0, 200)));
      checks.push(check('AC-12 S-15: response for a disallowed Origin is unchanged (no allow header)', bad.status === 200, `status=${bad.status}`));
      const n1 = fran.invalidEntries().length;
      await fran.req('GET', '/healthz', undefined, { Origin: 'https://prompt-vault-6gr.pages.dev' });
      checks.push(check('AC-12 S-15 control: an allowed Origin is not recorded', fran.invalidEntries().length === n1, 'allowed origin recorded'));
    } finally {
      await fran.stop();
    }

    return checks;
  },
};
