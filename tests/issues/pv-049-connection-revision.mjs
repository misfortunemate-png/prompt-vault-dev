import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

export default {
  issue: 'pv#49',
  title: 'Connection revision centrally fences backend-scoped async state',
  level: 'BEHAVIORAL',
  gate: true,
  verifierPath: 'tests/issues/pv-049-connection-revision.mjs',
  async verify() {
    const checks = [];
    const oldStorage = globalThis.localStorage;
    const oldFetch = globalThis.fetch;

    try {
      globalThis.localStorage = new MemoryStorage();

      const connection = await import('../../src/lib/connection.js');
      const { api } = await import('../../src/lib/api.js');

      const fran = connection.switchRoute('fran');
      const firstRevision = fran.revision;
      checks.push(check(
        'route selection creates a backend identity revision',
        typeof firstRevision === 'string' && firstRevision !== '0',
        'switchRoute(fran) did not create a non-default revision',
      ));

      const metadataOnly = connection.saveConnection({ ...fran, lastCheck: '2099-01-01T00:00:00.000Z' });
      checks.push(check(
        'non-identity metadata does not invalidate backend state',
        metadataOnly.revision === firstRevision,
        'lastCheck-only save changed the backend revision',
      ));

      const timeoutOnly = connection.updateSettings({ timeoutMs: 9100 });
      checks.push(check(
        'timeout preference does not invalidate backend state',
        timeoutOnly.revision === firstRevision,
        'timeout-only settings change changed the backend revision',
      ));

      const principalChanged = connection.updateSettings({ token: 'pv49-test-token-a' });
      checks.push(check(
        'authentication principal change invalidates backend state',
        principalChanged.revision !== firstRevision,
        'token change did not change the backend revision',
      ));

      const requestRevision = connection.getConnection().revision;
      let resolveFetch;
      globalThis.fetch = () => new Promise(resolve => { resolveFetch = resolve; });
      const pending = api.getCards();
      const switched = connection.switchRoute('cloud');
      const routeRevisionChanged = switched.revision !== requestRevision;
      resolveFetch({
        ok: true,
        status: 200,
        async json() { return { cards: [{ id: 'stale-a' }] }; },
      });

      let staleError = null;
      try { await pending; } catch (error) { staleError = error; }
      checks.push(check(
        'route change advances backend revision',
        routeRevisionChanged,
        'Fran -> Cloud switch kept the previous revision',
      ));
      checks.push(check(
        'API layer rejects a response from an obsolete connection snapshot',
        staleError?.code === 'STALE_CONNECTION',
        `expected STALE_CONNECTION, got ${staleError?.code || staleError?.name || 'no error'}`,
      ));

      const app = read('../../src/App.jsx');
      const connectionSource = read('../../src/lib/connection.js');
      const apiSource = read('../../src/lib/api.js');

      const revisionKeys =
        /<AlbumScreen\s+key=\{connectionState\.revision\}/.test(app)
        && /<TemplateScreen\s+key=\{connectionState\.revision\}/.test(app)
        && /<SettingsScreen[\s\S]{0,160}key=\{connectionState\.revision\}/.test(app);
      checks.push(check(
        'backend-scoped screens consume the common connection revision',
        revisionKeys,
        'Album/Template/Settings are not all keyed by connectionState.revision',
      ));

      // pv#81 PM 裁定（issuecomment-5842144262）により挙動検査へ差し替え：
      // 一覧は接続先（route+token）が変わったときに消え、offline を挟んで同じ接続先に戻っただけでは消えない
      let ownerVerdict = { ok: false, detail: 'resolveResultsOwner not found in App.jsx' };
      const ownerStart = app.indexOf('function resolveResultsOwner(');
      if (ownerStart >= 0) {
        let i = app.indexOf(') {', ownerStart) + 2;
        let depth = 0;
        let ownerSrc = '';
        for (; i < app.length; i++) {
          if (app[i] === '{') depth++;
          else if (app[i] === '}') { depth--; if (depth === 0) { ownerSrc = app.slice(ownerStart, i + 1); break; } }
        }
        const resolveOwner = new Function(`${ownerSrc}; return resolveResultsOwner;`)();
        let owner = null;
        const step = (route, token) => { const r = resolveOwner(owner, { route, token }); owner = r.owner; return r.clear; };
        step('cloud', 'T1');
        const offlineBlip = [step('offline', 'T1'), step('cloud', 'T1')];
        const toFran = step('fran', 'T1');
        const toCloud = step('cloud', 'T1');
        const tokenChanged = step('cloud', 'T2');
        const wired = /resolveResultsOwner\(resultsOwnerRef\.current, connectionState\)[\s\S]{0,160}if \(clear\) setResults\(\[\]\);[\s\S]{0,40}\[connectionState\.route, connectionState\.token\]/.test(app);
        ownerVerdict = {
          ok: wired && toFran && toCloud && tokenChanged && offlineBlip.every(c => c === false),
          detail: `wired=${wired} cloud→fran=${toFran} fran→cloud=${toCloud} token change=${tokenChanged} cloud→offline→cloud=${JSON.stringify(offlineBlip)}`,
        };
      }
      checks.push(check(
        'Generate results are invalidated when backend identity (route+token) changes',
        ownerVerdict.ok,
        ownerVerdict.detail,
      ));

      checks.push(check(
        'reachability probe refuses to commit after external connection intent changes',
        /captureConnectionSnapshot\(state\)/.test(connectionSource)
          && /isConnectionSnapshotCurrent\(snapshot\)/.test(connectionSource)
          && /current\.manual === state\.manual/.test(connectionSource),
        'reachability probe is not fenced by the shared connection snapshot/manual intent',
      ));

      checks.push(check(
        'API request path centrally asserts snapshot currency',
        /captureConnectionSnapshot\(conn\)/.test(apiSource)
          && /assertCurrentConnection\(snapshot, path\)/.test(apiSource)
          && /STALE_CONNECTION/.test(apiSource),
        'API request does not centrally fence stale completions',
      ));
    } finally {
      if (oldStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = oldStorage;
      if (oldFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = oldFetch;
    }

    return checks;
  },
};
