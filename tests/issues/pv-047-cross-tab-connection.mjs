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
    const uiRefresh = /setConnectionState\s*\(\s*getConnection\(\)\s*\)/.test(app)
      || /(?:subscribeConnection|useSyncExternalStore|onConnectionChange)/.test(combined);
    const apiReadsSharedState = /async\s+function\s+request[\s\S]{0,300}getConnection\(\)/.test(api);

    // Route alone is not the full request identity: franUrl/cloudUrl/token may change
    // while route remains unchanged. These route-only invalidation patterns are exactly
    // the current residual bug and must disappear (or be replaced by a full identity key).
    const routeOnlyTemplateKey = /<TemplateScreen\s+key=\{connectionState\.route\}/.test(app);
    const routeOnlySettingsKey = /<SettingsScreen[\s\S]{0,120}?key=\{connectionState\.route\}/.test(app);
    const routeOnlyResultsReset = /useEffect\(\(\)\s*=>\s*\{\s*setResults\(\[\]\);\s*\},\s*\[connectionState\.route\]\s*\)/s.test(app);
    const fullIdentityLifecycle = !routeOnlyTemplateKey && !routeOnlySettingsKey && !routeOnlyResultsReset;

    return [
      check(
        'external storage connection updates are observed',
        storageListener,
        'no storage-event or equivalent external connection subscription found',
      ),
      check(
        'external connection update reaches React connection state',
        storageListener && uiRefresh,
        'connection storage changes do not clearly update App/UI state',
      ),
      check(
        'Template/Settings/results are not invalidated by route alone',
        fullIdentityLifecycle,
        `route-only lifecycle remains: template=${routeOnlyTemplateKey} settings=${routeOnlySettingsKey} results=${routeOnlyResultsReset}`,
      ),
      check(
        'shared request identity cannot advance beyond displayed backend-scoped state',
        !apiReadsSharedState || ((storageListener && uiRefresh) && fullIdentityLifecycle),
        'API re-reads shared connection identity per request while backend-scoped UI still invalidates only on route',
      ),
    ];
  },
};
