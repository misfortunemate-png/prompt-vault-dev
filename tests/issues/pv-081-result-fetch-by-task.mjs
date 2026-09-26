import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

// 関数本体を { } の対応で切り出す
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  // 引数の分割代入 { ... } を飛ばし、本体の { から数える
  let i = src.indexOf(') {', start) + 2;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

// 名前の付いたブロック（const name = async (...) => { ... }）の本体を切り出す
function extractArrow(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return '';
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

export default {
  issue: 'pv#81',
  title: 'Unsaved results are fetched by task id, survive offline blips, and thumbs upload only after save',
  level: 'BEHAVIORAL',
  gate: true,
  verifierPath: 'tests/issues/pv-081-result-fetch-by-task.mjs',
  async verify() {
    const checks = [];
    const gen = read('../../src/screens/GenerateScreen.jsx');
    const app = read('../../src/App.jsx');

    // AC-2
    const galleryUses = (gen.match(/\/gallery\/image\//g) || []).length;
    checks.push(check('AC-2: GenerateScreen no longer uses /gallery/image/<hash>/data for just-generated results',
      galleryUses === 0, `/gallery/image/ occurrences=${galleryUses}`));
    const helper = extractFunction(gen, 'fetchTaskImage');
    checks.push(check('AC-2: task-id fetch helper hits /queue/task/<id>/data',
      !!helper && /\/queue\/task\/\$\{encodeURIComponent\(taskId\)\}\/data/.test(helper), 'fetchTaskImage missing or wrong path'));
    const helperCalls = (gen.match(/fetchTaskImage\(conn, /g) || []).length;
    checks.push(check('AC-2: all three sites (QueueTaskRow / queue completion / single generate) use the helper',
      helperCalls >= 3, `fetchTaskImage call sites=${helperCalls}`));
    const rowSrc = extractFunction(gen, 'QueueTaskRow') || '';
    checks.push(check('AC-2: QueueTaskRow keys the fetch by task.id',
      rowSrc.includes('fetchTaskImage(conn, task.id)'), 'QueueTaskRow does not fetch by task.id'));

    // AC-8（画面）: 404 → 期限切れ表示、他カードは継続
    checks.push(check('AC-8: helper maps 404 to expired (no throw)',
      !!helper && /status === 404/.test(helper) && /expired: true/.test(helper), 'helper lacks 404 → expired'));
    const cardSrc = extractFunction(gen, 'ResultCard') || '';
    checks.push(check('AC-8: ResultCard and QueueTaskRow render 期限切れ for expired items',
      cardSrc.includes('期限切れ') && rowSrc.includes('期限切れ'), 'expired label missing'));

    // AC-9（画面）: サムネは保存成功後のみ
    const handleSave = extractArrow(gen, 'const handleSave = async');
    const thumbCalls = (gen.match(/generateAndUploadThumb\(/g) || []).length;
    const thumbInSave = (handleSave.match(/generateAndUploadThumb\(/g) || []).length;
    const queueSaveIdx = gen.indexOf('api.queueTaskSave(task.id)');
    const queueSaveThumb = queueSaveIdx >= 0 && /uploadThumbAfterSave\(/.test(gen.slice(queueSaveIdx, queueSaveIdx + 400));
    const afterSaveFn = extractFunction(gen, 'uploadThumbAfterSave') || '';
    checks.push(check('AC-9: generateAndUploadThumb is called only from the after-save helper',
      thumbCalls === 1 && afterSaveFn.includes('generateAndUploadThumb('), `total calls=${thumbCalls} inHelper=${afterSaveFn.includes('generateAndUploadThumb(')}`));
    checks.push(check('AC-9: handleSave uploads the thumb after a successful cloud save',
      /saveImage\(\{ task_id: item\.task_id \}\)[\s\S]*uploadThumbAfterSave\(/.test(handleSave) || thumbInSave > 0,
      'handleSave does not upload after save'));
    checks.push(check('AC-9: queue row save uploads the thumb after queueTaskSave succeeds', queueSaveThumb,
      'queue save path lacks after-save upload'));

    // AC-5: 一覧の持ち主（route+token）
    const ownerSrc = extractFunction(app, 'resolveResultsOwner');
    let ac5 = { ok: false, detail: 'resolveResultsOwner missing in App.jsx' };
    if (ownerSrc) {
      const resolve = new Function(`${ownerSrc}; return resolveResultsOwner;`)();
      let owner = null;
      const step = (conn) => { const r = resolve(owner, conn); owner = r.owner; return r.clear; };
      const trace = [];
      trace.push(['cloud/A', step({ route: 'cloud', token: 'A' })]);
      trace.push(['offline/A', step({ route: 'offline', token: 'A' })]);
      trace.push(['cloud/A', step({ route: 'cloud', token: 'A' })]);
      const blipKept = trace.every(([, c]) => c === false);
      const toFran = step({ route: 'fran', token: 'A' });
      const backCloud = step({ route: 'cloud', token: 'A' });
      const tokenChange = step({ route: 'cloud', token: 'B' });
      step({ route: 'offline', token: 'B' });
      const tokenViaOffline = step({ route: 'cloud', token: 'C' });
      ac5 = {
        ok: blipKept && toFran && backCloud && tokenChange && tokenViaOffline,
        detail: `blip=${JSON.stringify(trace)} cloud→fran=${toFran} fran→cloud=${backCloud} token A→B=${tokenChange} token B→(offline)→C=${tokenViaOffline}`,
      };
    }
    checks.push(check('AC-5: cloud→offline→cloud (same token) keeps results; cloud↔fran and token change clear', ac5.ok, ac5.detail));
    const revisionWipe = /useEffect\(\(\) => \{\s*setResults\(\[\]\);\s*\}, \[connectionState\.revision\]\)/.test(app);
    checks.push(check('AC-5: results are no longer wiped on every revision change', !revisionWipe, 'revision-keyed setResults([]) still present'));

    // S-3: メモリ保持のみ（永続化しない）
    const persists = /(localStorage|sessionStorage|indexedDB)[^\n]*results/i.test(app) || /(localStorage|sessionStorage|indexedDB)[^\n]*setResults/.test(gen);
    checks.push(check('S-3: results are not persisted to web storage', !persists, 'results persisted'));

    return checks;
  },
};
