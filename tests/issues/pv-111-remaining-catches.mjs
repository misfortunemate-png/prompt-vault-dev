// pv#111: 調査に入っていなかった握りつぶしに残余の型を持たせる（軽微）
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './lib/fran-harness.mjs';
import { MemStore, freshImport, withGlobals, check } from './lib/front-env.mjs';

const src = (p) => readFileSync(join(repoRoot, p), 'utf8');
const isBool = (v) => typeof v === 'boolean';

class ThrowingStore {
  getItem() { throw new Error('SecurityError: storage disabled'); }
  setItem() { throw new Error('QuotaExceededError'); }
  removeItem() {}
}

export default {
  issue: 'pv#111',
  title: 'Swallowed catches outside the 72-point survey get a residue type (light)',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-111-remaining-catches.mjs',

  async verify() {
    const checks = [];
    const lib = 'src/lib/storedValues.js';
    if (!existsSync(join(repoRoot, lib))) {
      checks.push(check('storedValues module exists', false, `${lib} not found`));
    } else {
      // 復元: 壊れた JSON・配列・当たらない値・読めない保存領域
      const store = new MemStore({
        'k-broken': '{not json',
        'k-array': '[1,2]',
        'k-mixed': JSON.stringify({ s_a: true, s_b: 'yes', s_c: false }),
        'k-int': 'abc',
        'k-int-range': '9999',
        'k-obj': JSON.stringify({ theme: 'neon', fontSize: 16, extra: 1 }),
      });
      await withGlobals({ localStorage: store }, async () => {
        const log = await freshImport('src/lib/invalidLog.js');
        const sv = await freshImport(lib);
        const at = () => log.getInvalidLog();
        checks.push(check('absent key returns null without recording', sv.readStoredMap('k-none', 'pv111', isBool, '真偽値') === null && at().length === 0, JSON.stringify(at())));
        checks.push(check('unparseable JSON is recorded with the raw text and yields null', sv.readStoredMap('k-broken', 'pv111', isBool, '真偽値') === null && at().some(e => e.raw.includes('{not json')), JSON.stringify(at()).slice(0, 300)));
        checks.push(check('a non-object (array) is recorded and yields null', sv.readStoredMap('k-array', 'pv111', isBool, '真偽値') === null && at().some(e => e.raw.includes('[1,2]')), JSON.stringify(at()).slice(0, 300)));
        const mixed = sv.readStoredMap('k-mixed', 'pv111', isBool, '真偽値');
        checks.push(check('values that do not match are skipped and recorded; matching ones are kept',
          JSON.stringify(mixed) === '{"s_a":true,"s_c":false}' && at().some(e => e.raw.includes('s_b') && e.raw.includes('yes')), `${JSON.stringify(mixed)} ${JSON.stringify(at()).slice(-300)}`));
        const n0 = at().length;
        const i1 = sv.readStoredInt('k-int', 'pv111', { min: 60, max: 200, fallback: 110 });
        const i2 = sv.readStoredInt('k-int-range', 'pv111', { min: 60, max: 200, fallback: 110 });
        checks.push(check('an int outside the rule uses the fallback and is recorded with the raw value',
          i1 === 110 && i2 === 110 && at().slice(n0).some(e => e.raw.includes('abc')) && at().slice(n0).some(e => e.raw.includes('9999')), JSON.stringify(at().slice(n0))));
        const o = sv.readStoredObject('k-obj', 'pv111', { theme: [v => ['light', 'dark', 'sepia'].includes(v), 'light/dark/sepia'], fontSize: [v => Number.isFinite(v), '数'] });
        checks.push(check('an object keeps matching fields; unknown keys and bad values are recorded',
          JSON.stringify(o) === '{"fontSize":16}' && at().some(e => e.raw.includes('neon')) && at().some(e => e.raw.includes('extra')), `${JSON.stringify(o)} ${JSON.stringify(at()).slice(-300)}`));
        const n1 = at().length;
        sv.parseJsonOnce('{bad', { kind: 'k', stage: 'pv111', id: 'h1' });
        sv.parseJsonOnce('{bad', { kind: 'k', stage: 'pv111', id: 'h1' });
        checks.push(check('parseJsonOnce records an unparseable field once per id', at().length === n1 + 1, JSON.stringify(at().slice(n1))));
        checks.push(check('parseJsonOnce control: valid JSON is returned', JSON.stringify(sv.parseJsonOnce('{"a":1}', { kind: 'k', stage: 'pv111', id: 'h2' })) === '{"a":1}', 'valid JSON not returned'));
      });
      // 書き込み・読み込みできない保存領域
      await withGlobals({ localStorage: new ThrowingStore() }, async () => {
        const sv = await freshImport(lib);
        // 集約先はメモリに退避するので、storedValues.js が読み込んだのと同じ実体を見る
        const log = await import(pathToFileURL(join(repoRoot, 'src/lib/invalidLog.js')).href);
        const ok = sv.writeStored('k-w', { a: 1 }, 'pv111.write');
        const r = sv.readStoredMap('k-r', 'pv111.read', isBool, '真偽値');
        const entries = log.getInvalidLog();
        checks.push(check('write failure returns false and is recorded; read failure yields null and is recorded',
          ok === false && r === null && entries.some(e => /pv111\.write/.test(e.stage)) && entries.some(e => /pv111\.read/.test(e.stage)), JSON.stringify(entries).slice(0, 300)));
      });
    }

    // 画面の各箇所（静的）: 黙る形が消え、集約先を通している
    const gen = src('src/screens/GenerateScreen.jsx');
    checks.push(check('GenerateScreen: pv3-* restores go through readStoredMap', !/JSON\.parse\(localStorage\.getItem\('pv3-(selected-cards|slot-random|slot-enabled|random-child-mode|selected-children)'\)\)/.test(gen) && (gen.match(/readStoredMap\('pv3-/g) || []).length === 5, 'direct JSON.parse of pv3-* remains'));
    checks.push(check('GenerateScreen: pv3-* saves go through writeStored (no silent catch)', !/localStorage\.setItem\('pv3-[^']+', [^;]*\);\s*\}?\s*catch \{\}/.test(gen) && !/try \{ localStorage\.setItem\('pv3-/.test(gen), 'silent pv3 save remains'));
    const viewer = src('src/components/ImageViewer.jsx');
    checks.push(check('ImageViewer: settings fetch failure is recorded', !/setDefaultCaptionStyle\(s\.captionStyle\); \}\)\.catch\(\(\) => \{\}\)/.test(viewer), 'silent settings catch remains'));
    checks.push(check('ImageViewer: caption_config / char_prompts parse failures are recorded', !/JSON\.parse\(detail\.caption_config\); \} catch \{\}/.test(viewer) && !/JSON\.parse\(d\.caption_config\)\); \} catch \{\}/.test(viewer) && !/JSON\.parse\(d\.char_prompts\); \} catch \{ return null; \}/.test(viewer) && /parseJsonOnce\(/.test(viewer), 'silent parse remains'));
    checks.push(check('ImageViewer: card dialog / card registration / delete failures are recorded', (viewer.match(/recordFailure\('pv#111 ImageViewer\./g) || []).length >= 4, 'card/delete failure records missing'));
    const album = src('src/screens/AlbumScreen.jsx');
    checks.push(check('AlbumScreen: pv_thumbColMin is read/written through storedValues', !/parseInt\(localStorage\.getItem\('pv_thumbColMin'\)\) \|\| 110/.test(album) && !/try \{ localStorage\.setItem\('pv_thumbColMin', val\); \} catch \{\}/.test(album) && /readStoredInt\('pv_thumbColMin'/.test(album), 'silent thumbColMin remains'));
    checks.push(check('AlbumScreen: favorites / search / preset / rescan-start failures are recorded', (album.match(/recordFailure\('pv#111 AlbumScreen\./g) || []).length >= 4, 'records missing'));
    const app = src('src/App.jsx');
    checks.push(check('App: display settings restore goes through readStoredObject (no silent catch)', /readStoredObject\(DISPLAY_KEY/.test(app) && !/JSON\.parse\(saved\) \};\s*\} catch \{\}/.test(app), 'silent display settings restore remains'));
    return checks;
  },
};
