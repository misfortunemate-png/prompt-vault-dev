import { readFileSync } from 'node:fs';

function check(name, ok, detail = '') { return { name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail }; }
function between(source, start, end) {
  const a = source.indexOf(start); if (a < 0) throw new Error(`start marker not found: ${start}`);
  const b = source.indexOf(end, a + start.length); if (b < 0) throw new Error(`end marker not found: ${end}`);
  return source.slice(a, b);
}

export default {
  issue: 'pv#16',
  title: 'backend-bound generate results and queue state',
  level: 'STATIC_CONTRACT',
  gate: true,
  verifierPath: 'tests/issues/pv-016-backend-identity.mjs',
  async verify() {
    const src = readFileSync(new URL('../../src/screens/GenerateScreen.jsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
    const checks = [];
    checks.push(check('route change clears displayed direct results', /setResults\(\[\]\)/.test(app) && /connectionState\.route/.test(app), 'App does not clearly clear results on route change'));

    let generate = '', save = '';
    try {
      generate = between(src, 'const handleGenerate = async () => {', 'const handleSave = async (idx) => {');
      save = between(src, 'const handleSave = async (idx) => {', '// ── Render ──');
    } catch (e) { return [...checks, check('generate/save handlers extracted', false, e.message)]; }

    const staleClosureGuard = /(?:const|let)\s+\w*(?:route|Route)\w*\s*=\s*connectionRoute[\s\S]*await\s+api\.generate[\s\S]*if\s*\(\s*connectionRoute\s*!==\s*\w*(?:route|Route)\w*\s*\)/.test(generate);
    checks.push(check('known stale React-closure guard is not accepted', !staleClosureGuard, 'request route and post-await connectionRoute are captured by the same render closure'));

    const liveGuard = /(?:getConnection\(\)\.route|\w*(?:route|Route)Ref\.current)\s*!==\s*\w*(?:route|Route)\w*/.test(generate);
    const resultOrigin = /(?:backend|originRoute|sourceRoute|requestRoute|routeAtFetch)\s*:/.test(generate) && /item\.(?:backend|originRoute|sourceRoute|requestRoute|routeAtFetch)/.test(save);
    checks.push(check('late generate response has live route guard or persisted backend origin', liveGuard || resultOrigin, 'no live post-await identity check or result-origin binding found'));

    const saveCurrentRouteOnly = /const\s+conn\s*=\s*getConnection\(\)[\s\S]*conn\.route/.test(save) && !/item\.(?:backend|originRoute|sourceRoute|requestRoute|routeAtFetch)/.test(save);
    checks.push(check('save is not selected solely by click-time global route', !saveCurrentRouteOnly || liveGuard, 'save still relies on current global route for an origin-less result'));

    const queueRouteEffect = /connectionRoute[\s\S]{0,800}(?:api\.getQueue\s*\(|setQueueData\s*\()/s.test(src);
    checks.push(check('queue state is refreshed/reset on backend route changes', queueRouteEffect, 'queue state is not clearly rebound to connectionRoute'));
    return checks;
  },
};
