import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

export default {
  issue: 'pv#47',
  title: 'cross-tab connection changes cannot split displayed and request backend',
  level: 'STATIC_CONTRACT',
  gate: true,
  verifierPath: 'tests/issues/pv-047-cross-tab-connection.mjs',
  async verify() {
    const app = read('../../src/App.jsx');
    const connection = read('../../src/lib/connection.js');
    const api = read('../../src/lib/api.js');
    const combined = `${app}\n${connection}`;
    const storageListener = /addEventListener\s*\(\s*['"]storage['"]/.test(combined);
    const uiRefresh = /setConnectionState\s*\(\s*getConnection\(\)\s*\)/.test(app) || /(?:subscribeConnection|useSyncExternalStore|onConnectionChange)/.test(combined);
    const apiReadsSharedState = /async\s+function\s+request[\s\S]{0,300}getConnection\(\)/.test(api);
    return [
      check('external storage connection updates are observed', storageListener, 'no storage-event or equivalent external connection subscription found'),
      check('external connection update reaches React connection state', storageListener && uiRefresh, 'connection storage changes do not clearly update App/UI state'),
      check('shared connection state used by API is matched by UI subscription', !apiReadsSharedState || (storageListener && uiRefresh), 'API re-reads shared localStorage while UI has no matching external-update subscription'),
    ];
  },
};
