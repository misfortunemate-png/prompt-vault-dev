import { readFileSync } from 'node:fs';

function check(name, ok, detail = '') {
  return { name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail };
}

function between(source, start, end) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`start marker not found: ${start}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  return source.slice(a, b);
}

export default {
  issue: 'pv#16',
  title: 'backend-bound generate results and queue state',
  level: 'STATIC',
  gate: false,

  async verify() {
    const generateSource = readFileSync(new URL('../../src/screens/GenerateScreen.jsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
    const checks = [];

    checks.push(check(
      'route change clears previously displayed direct results',
      /useEffect\(\(\) => \{\s*setResults\(\[\]\);\s*\}, \[connectionState\.route\]\);/s.test(appSource),
      'App route effect does not clearly clear results',
    ));

    let generateBody = '';
    let saveBody = '';
    try {
      generateBody = between(generateSource, 'const handleGenerate = async () => {', 'const handleSave = async (idx) => {');
      saveBody = between(generateSource, 'const handleSave = async (idx) => {', '// ── Render ──');
    } catch (error) {
      return [...checks, { name: 'generation/save handlers extracted', status: 'FAIL', detail: error.message }];
    }

    const generateAwait = generateBody.indexOf('await api.generate');
    const connectionBeforeRequest = generateAwait >= 0 && generateBody.slice(0, generateAwait).includes('getConnection()');
    const postGenerate = generateAwait >= 0 ? generateBody.slice(generateAwait) : '';
    const explicitOrigin = /(?:requestRoute|requestConnection|originRoute|sourceRoute|backend)/.test(generateBody);
    const lateResponseGuard = /if\s*\([^\n]*(?:connectionRoute|getConnection\(\)\.route)[^\n]*!==[^\n]*\)\s*(?:\{\s*)?return/.test(postGenerate);
    const responseIdentitySafe = connectionBeforeRequest || explicitOrigin || lateResponseGuard;

    checks.push(check(
      'in-flight generate response keeps request backend identity',
      responseIdentitySafe,
      'api.generate is awaited before backend identity is captured, and no explicit origin/route guard is present',
    ));

    const saveUsesItemOrigin = /item\.(?:backend|route|originRoute|sourceRoute)/.test(saveBody);
    checks.push(check(
      'late result cannot be saved to a different backend',
      saveUsesItemOrigin || lateResponseGuard,
      'handleSave chooses getConnection() at click time and result has no backend origin / late-response discard guard',
    ));

    const cloudMarker = generateSource.indexOf("if (connectionRoute === 'cloud') {");
    let franBranch = '';
    if (cloudMarker >= 0) {
      const elseMarker = generateSource.indexOf('} else {', cloudMarker);
      const catchMarker = generateSource.indexOf('} catch (e) {', elseMarker);
      if (elseMarker >= 0 && catchMarker > elseMarker) franBranch = generateSource.slice(elseMarker, catchMarker);
    }
    const franQueueRefresh = /api\.getQueue\s*\(/.test(franBranch) || /setQueueData\s*\(/.test(franBranch);
    checks.push(check(
      'Cloud→Fran route change reloads or resets queue state',
      franQueueRefresh,
      'Fran branch reloads cards/presets but neither fetches nor resets queueData',
    ));

    return checks;
  },
};
