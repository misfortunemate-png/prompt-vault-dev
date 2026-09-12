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

    // Route alone is not the full API identity. The effective endpoint/auth can change
    // while route stays "cloud" or "fran" (for example from another tab editing URLs).
    // A safe implementation may use a composite key, generation/revision token, or
    // equivalent lifecycle invalidation, but must not key backend-scoped state only by route.
    const routeOnlyTemplateKey = /<TemplateScreen\s+key=\{connectionState\.route\}/.test(app);
    const routeOnlySettingsKey = /<SettingsScreen[\s\S]{0,120}?key=\{connectionState\.route\}/.test(app);
    const routeOnlyResultsReset = /useEffect\(\(\)\s*=>\s*\{\s*setResults\(\[\]\);\s*\},\s*\[connectionState\.route\]\s*\)/s.test(app);

    const explicitIdentityLifecycle = /(?:connection|backend)(?:Identity|Key|Generation|Revision|Epoch)/i.test(app)
      || /key=\{[^}]*connectionState\.(?:franUrl|cloudUrl|token)[^}]*\}/s.test(app)
      || /\[[^\]]*connectionState\.(?:franUrl|cloudUrl|token)[^\]]*\]/s.test(app);

    const backendScopedLifecycleSafe = explicitIdentityLifecycle
      || (!routeOnlyTemplateKey && !routeOnlySettingsKey && !routeOnlyResultsReset);

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
        'backend-scoped UI lifecycle is not keyed only by route',
        backendScopedLifecycleSafe,
        'Template/Settings/results still invalidate only on connectionState.route; same-route URL/token changes can leave stale state',
      ),
      check(
        'shared request identity cannot advance beyond displayed backend-scoped state',
        !apiReadsSharedState || ((storageListener && uiRefresh) && backendScopedLifecycleSafe),
        'API re-reads shared connection identity per request while UI lifecycle does not invalidate on same-route identity changes',
      ),
    ];
  },
};
