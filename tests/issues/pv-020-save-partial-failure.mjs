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
  issue: 'pv#20',
  title: 'Fran save partial failure semantics',
  level: 'STATIC',

  async verify() {
    const generateSource = readFileSync(new URL('../../server/generate.js', import.meta.url), 'utf8');
    const serverSource = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const uiSource = readFileSync(new URL('../../src/screens/GenerateScreen.jsx', import.meta.url), 'utf8');
    const checks = [];

    checks.push(check(
      'executeSave exposes DB/index failure as warning',
      /dbWarning\s*=\s*dbErr\.message/.test(generateSource) && /warning:\s*dbWarning/.test(generateSource),
      'executeSave does not expose DB failure state',
    ));

    let directSave = '';
    let queueSave = '';
    let uiSave = '';
    try {
      directSave = between(serverSource, "api.post('/save'", '// ── 画像配信');
      queueSave = between(serverSource, "api.post('/queue/task/:id/save'", "app.use('/api', api)");
      uiSave = between(uiSource, 'const handleSave = async (idx) => {', '// ── Render ──');
    } catch (error) {
      return [...checks, { name: 'save handlers extracted', status: 'FAIL', detail: error.message }];
    }

    const directHandlesWarning = /if\s*\(\s*saved\.warning\s*\)/.test(directSave)
      || /success:\s*!+\s*saved\.warning/.test(directSave)
      || /status\(5\d\d\)[\s\S]*saved\.warning/.test(directSave);
    checks.push(check(
      'direct /save does not report DB warning as full success',
      directHandlesWarning,
      'route always returns success:true even when executeSave reports warning',
    ));

    const warningIdx = uiSave.indexOf('r?.warning');
    const savedTrueIdx = uiSave.indexOf('saved: true');
    const warningStopsSuccess = warningIdx >= 0 && savedTrueIdx > warningIdx
      && /(?:return|throw|saved:\s*false)/.test(uiSave.slice(warningIdx, savedTrueIdx));
    checks.push(check(
      'frontend keeps result retryable after DB warning',
      warningStopsSuccess,
      'warning toast is shown but result is still unconditionally marked saved:true',
    ));

    const queueObservesWarning = /saved\.warning/.test(queueSave);
    const queueMarksSaved = /task\.saved\s*=\s*true/.test(queueSave);
    checks.push(check(
      'queue save preserves the same partial-failure semantics',
      queueObservesWarning && (!queueMarksSaved || /if\s*\(\s*!?saved\.warning/.test(queueSave)),
      'queue save ignores saved.warning and marks task.saved=true',
    ));

    return checks;
  },
};
