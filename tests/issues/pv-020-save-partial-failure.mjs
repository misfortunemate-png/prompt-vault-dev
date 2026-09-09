import { readFileSync } from 'node:fs';

function check(name, ok, detail = '') {
  return { name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail };
}

function acceptedResidual(name, ok, detail = '') {
  return { name, status: ok ? 'PASS' : 'WAIVED', detail: ok ? '' : detail };
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
  gate: true,

  async verify() {
    const generateSource = readFileSync(new URL('../../server/generate.js', import.meta.url), 'utf8');
    const serverSource = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const uiSource = readFileSync(new URL('../../src/screens/GenerateScreen.jsx', import.meta.url), 'utf8');
    const scannerSource = readFileSync(new URL('../../server/scanner.js', import.meta.url), 'utf8');
    const checks = [];

    checks.push(check(
      'primary PNG is copied before DB/index registration',
      generateSource.indexOf('copyFileSync(srcPath, finalPath)') >= 0
        && generateSource.indexOf('copyFileSync(srcPath, finalPath)') < generateSource.indexOf('upsertImage({'),
      'save no longer clearly preserves the primary PNG before DB registration',
    ));
    checks.push(check(
      'executeSave exposes DB/index failure as warning',
      /dbWarning\s*=\s*dbErr\.message/.test(generateSource) && /warning:\s*dbWarning/.test(generateSource),
      'executeSave does not expose DB failure state',
    ));
    checks.push(check(
      'rescan can re-index a PNG missing from the DB',
      /if\s*\(!existing\)\s*\{[\s\S]*?upsertImage\s*\(\{/m.test(scannerSource),
      'scanner recovery path for a filesystem-only PNG was not found',
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
    checks.push(acceptedResidual(
      'direct /save does not report DB warning as full success',
      directHandlesWarning,
      'WAIVED: direct response remains success:true but carries warning; primary PNG is retained and rescan is available',
    ));

    const warningIdx = uiSave.indexOf('r?.warning');
    const savedTrueIdx = uiSave.indexOf('saved: true');
    const warningStopsSuccess = warningIdx >= 0 && savedTrueIdx > warningIdx
      && /(?:return|throw|saved:\s*false)/.test(uiSave.slice(warningIdx, savedTrueIdx));
    checks.push(acceptedResidual(
      'frontend keeps result retryable after DB warning',
      warningStopsSuccess,
      'WAIVED: warning is visible but result is marked saved because the primary PNG already exists',
    ));

    const queueObservesWarning = /saved\.warning/.test(queueSave);
    const queueMarksSaved = /task\.saved\s*=\s*true/.test(queueSave);
    checks.push(acceptedResidual(
      'queue save preserves the same partial-failure semantics',
      queueObservesWarning && (!queueMarksSaved || /if\s*\(\s*!?saved\.warning/.test(queueSave)),
      'WAIVED: queue save does not surface the DB warning; exceptional recovery remains rescan/log based',
    ));

    return checks;
  },
};
