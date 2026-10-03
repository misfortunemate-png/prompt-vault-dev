// pv#98: Invalid の集約先を一つ置く（J-1）
import { existsSync, readFileSync, appendFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startFran, repoRoot } from './lib/fran-harness.mjs';
import { MemStore, freshImport, withGlobals, check } from './lib/front-env.mjs';

const INVALID_FIELDS = ['kind', 'stage', 'raw', 'reason'];
function grepTree(dir, re) {
  const hits = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) hits.push(...grepTree(p, re));
    else if (/\.(js|jsx|mjs)$/.test(name)) {
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) hits.push(`${p}:${i + 1}: ${l.trim()}`); });
    }
  }
  return hits;
}
const hasFields =(e) => e && e.code === 'INVALID' && INVALID_FIELDS.every(k => typeof e[k] === 'string' && e[k].length > 0);

export default {
  issue: 'pv#98',
  title: 'One aggregation point for invalid residue (Fran logs/ INVALID + front store + settings debug view)',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-098-invalid-aggregator.mjs',

  async verify() {
    const checks = [];

    // ── AC-1: Fran — 残余（S-17: settings.json が JSON でない）を一つ起こす ──
    const fran = await startFran({ name: 'pv098', data: { 'settings.json': '{ "generation": { broken' } });
    try {
      checks.push(check('AC-1: Fran test instance starts', fran.up, fran.output.slice(-800)));
      const r = await fran.req('GET', '/settings');
      checks.push(check('AC-1: GET /settings response is unchanged for an unparseable settings.json (500, J-5)',
        r.status === 500, `status=${r.status} body=${r.text.slice(0, 200)}`));
      const inv = fran.invalidEntries();
      const s17 = inv.find(e => hasFields(e) && /S-17/.test(e.stage));
      checks.push(check('AC-1: logs/ has code INVALID with kind/stage/raw/reason for the residue',
        !!s17, `INVALID entries=${JSON.stringify(inv).slice(0, 400)}`));
      checks.push(check('AC-1: raw keeps the original text', !!s17 && s17.raw.includes('broken'), `raw=${s17?.raw}`));

      const dbg = await fran.req('GET', '/debug/errors');
      const listed = Array.isArray(dbg.json) && dbg.json.some(e => hasFields(e) && /S-17/.test(e.stage));
      checks.push(check('AC-1: /debug/errors returns the INVALID entry', listed, `status=${dbg.status} body=${dbg.text.slice(0, 300)}`));

      // S-20: 解析できない行を黙って捨てない
      const today = new Date().toISOString().slice(0, 10);
      mkdirSync(fran.logDir, { recursive: true });
      appendFileSync(join(fran.logDir, `${today}.log`), 'THIS LINE IS NOT JSON {\n');
      const dbg2 = await fran.req('GET', '/debug/errors');
      const s20 = Array.isArray(dbg2.json) && dbg2.json.find(e => e && e.code === 'INVALID' && /S-20/.test(e.stage || ''));
      checks.push(check('AC-1 (S-20): /debug/errors keeps an unparseable log line as INVALID with its raw text',
        !!s20 && String(s20.raw).includes('THIS LINE IS NOT JSON'), `body=${dbg2.text.slice(0, 400)}`));
    } finally {
      await fran.stop();
    }

    // ── AC-2: フロントの集約先 ──
    const modPath = 'src/lib/invalidLog.js';
    if (!existsSync(join(repoRoot, modPath))) {
      checks.push(check('AC-2: front aggregation module exists', false, `${modPath} not found`));
    } else {
      const store = new MemStore();
      await withGlobals({ localStorage: store }, async () => {
        const m1 = await freshImport(modPath);
        m1.recordInvalid({ kind: 'test-kind', stage: 'pv98.verify', raw: { v: 'odd-value' }, reason: 'verifier injected' });
        const before = m1.getInvalidLog();
        checks.push(check('AC-2: recordInvalid stores kind/stage/raw/reason',
          before.length === 1 && INVALID_FIELDS.every(k => typeof before[0][k] === 'string') && before[0].raw.includes('odd-value'),
          JSON.stringify(before)));

        const m2 = await freshImport(modPath); // 再読み込みの模擬（新しいモジュール実体・同じ保存領域）
        const after = m2.getInvalidLog();
        checks.push(check('AC-2: entries survive a reload', after.length === 1 && after[0].kind === 'test-kind', JSON.stringify(after)));

        // 同じ kind・stage・raw は数えて一つにまとめる（件数は消さない）
        m2.recordInvalid({ kind: 'test-kind', stage: 'pv98.verify', raw: { v: 'odd-value' }, reason: 'again' });
        const merged = m2.getInvalidLog();
        checks.push(check('AC-2: same kind/stage/raw is merged with count', merged.length === 1 && merged[0].count === 2, JSON.stringify(merged)));

        const limit = m2.INVALID_LOG_LIMIT;
        checks.push(check('AC-2: a numeric upper limit exists', Number.isInteger(limit) && limit > 0, `limit=${limit}`));
        for (let i = 0; i < limit + 5; i++) m2.recordInvalid({ kind: 'flood', stage: 'pv98.verify', raw: `n=${i}`, reason: 'flood' });
        const capped = m2.getInvalidLog();
        const raws = capped.map(e => e.raw);
        checks.push(check('AC-2: over the limit, the oldest entries drop first',
          capped.length === limit && !raws.includes('n=0') && raws.includes(`n=${limit + 4}`) && !capped.some(e => e.kind === 'test-kind'),
          `length=${capped.length} first=${raws[0]} last=${raws[raws.length - 1]}`));

        // J-2: コードが定めて扱う結果（接続先の切替で古い応答を捨てた・未接続で取得しない）は残余にしない
        store.removeItem('pv-invalid-log');
        const stale = Object.assign(new Error('接続先が変更されたため古い応答を破棄しました: /x'), { code: 'STALE_CONNECTION' });
        const { api } = await freshImport('src/lib/api.js');
        let offlineErr = null;
        try { await api.getCards(); } catch (e) { offlineErr = e; } // localStorage に接続設定がない → offline
        m2.recordFailure('pv98.verify', 'test-failure', stale);
        if (offlineErr) m2.recordFailure('pv98.verify', 'test-failure', offlineErr);
        const afterDefined = m2.getInvalidLog();
        checks.push(check('AC-2 (J-2): StaleConnectionError and the offline refusal are not recorded as residue',
          !!offlineErr && afterDefined.length === 0, `offlineErr=${offlineErr?.message} code=${offlineErr?.code} log=${JSON.stringify(afterDefined).slice(0, 300)}`));
        m2.recordFailure('pv98.verify', 'test-failure', Object.assign(new Error('サーバーエラー (500)'), { status: 500 }));
        checks.push(check('AC-2 control: other failures are recorded', m2.getInvalidLog().length === 1, JSON.stringify(m2.getInvalidLog()).slice(0, 200)));

        // 保存領域そのものが壊れていても黙って空にしない
        store.setItem('pv-invalid-log', 'not json');
        const m3 = await freshImport(modPath);
        const broken = m3.getInvalidLog();
        checks.push(check('AC-2: a corrupted store is itself reported, not silently emptied',
          broken.some(e => e.raw && e.raw.includes('not json')), JSON.stringify(broken)));
      });
    }

    // 設定 → デバッグ・接続: フロントの分と、接続中の経路の /debug/errors を並べる。offline でもフロントの分は出る
    const settings = readFileSync(join(repoRoot, 'src/screens/SettingsScreen.jsx'), 'utf8');
    checks.push(check('AC-2: settings debug imports the front aggregation store',
      /from '\.\.\/lib\/invalidLog(\.js)?'/.test(settings), 'invalidLog import missing in SettingsScreen.jsx'));
    const panelIdx = settings.indexOf('<InvalidLogPanel');
    const before = panelIdx >= 0 ? settings.slice(Math.max(0, panelIdx - 400), panelIdx) : '';
    checks.push(check('AC-2: the front list is rendered without a route condition (visible offline)',
      panelIdx >= 0 && !/route\s*[!=]==?\s*'(fran|cloud|offline)'\s*&&\s*\(?\s*$/.test(before.trimEnd()),
      panelIdx >= 0 ? 'InvalidLogPanel is guarded by a route condition' : 'InvalidLogPanel not rendered'));
    checks.push(check('AC-2: the route /debug/errors list is shown next to it',
      settings.includes('api.getErrors()') && /接続中の経路/.test(settings), 'route error list label missing'));

    // ── AC-3: ErrorCode・createError の並立がない ──
    const errorsJs = existsSync(join(repoRoot, 'src/lib/errors.js'));
    const refs = grepTree(join(repoRoot, 'src'), /ErrorCode|createError/).join('\n');
    checks.push(check('AC-3: no parallel ErrorCode/createError mechanism remains', !errorsJs && refs.trim() === '',
      `errors.js exists=${errorsJs} refs=${refs.trim().slice(0, 300)}`));

    return checks;
  },
};
