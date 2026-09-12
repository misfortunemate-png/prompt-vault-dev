import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

export default {
  issue: 'pv#43',
  title: 'Settings values and diagnostics stay bound to current backend',
  level: 'STATIC_CONTRACT',
  gate: true,
  verifierPath: 'tests/issues/pv-043-settings-backend-identity.mjs',
  async verify() {
    const app = read('../../src/App.jsx');
    const settings = read('../../src/screens/SettingsScreen.jsx');
    const keyed = /<SettingsScreen[\s\S]{0,400}key=\{\s*connectionState\.route\s*\}/.test(app);
    const routeAwareEffect = /useEffect\([\s\S]{0,1200}(?:api\.getSettings|api\.getSystemInfo)[\s\S]{0,500}\[[^\]]*(?:connectionState\.route|connectionRoute|route)[^\]]*\]/s.test(settings);
    const sourceIdentity = /(?:settingsRoute|sourceRoute|backendRoute|loadedRoute)/.test(settings);
    const saveGuard = /(?:settingsRoute|sourceRoute|backendRoute|loadedRoute)[\s\S]{0,400}(?:putSettings|return)/s.test(settings);
    return [
      check('settings reload/remount when backend route changes', keyed || routeAwareEffect, 'settings/system-info load is not bound to route changes'),
      check('stale loaded settings cannot be saved to another backend', keyed || (sourceIdentity && saveGuard), 'no loaded-backend identity or route-keyed remount guards putSettings'),
      check('diagnostic/system info is rebound with settings route', keyed || routeAwareEffect, 'system info can remain from the prior backend'),
    ];
  },
};
