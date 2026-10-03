// pv#100: 保存・削除で未知の値を確かめずに書き換えない（J-6・J-7・J-8）
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startFran, repoRoot, makeTempRoot, removeTempRoot } from './lib/fran-harness.mjs';
import { MemStore, freshImport, withGlobals, check } from './lib/front-env.mjs';

const FX = join(repoRoot, 'tests', 'issues', 'fixtures', 'pv100');
const fx = (n) => JSON.parse(readFileSync(join(FX, n), 'utf8'));
const sha = (p) => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'missing';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f20000000049454e44ae426082', 'hex');
const notRun = (name, detail) => ({ name, status: 'NOT_RUN', detail });

function readLocalJson(rel) {
  const p = join(repoRoot, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export default {
  issue: 'pv#100',
  title: 'Write paths reject unknown values without writing; deletions are recorded first',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-100-write-guard.mjs',

  async verify() {
    const checks = [];
    const fran = await startFran({
      name: 'pv100',
      data: { 'settings.json': fx('settings.json'), 'cards.json': fx('cards.json'), 'presets.json': fx('presets.json') },
    });
    try {
      checks.push(check('Fran test instance starts', fran.up, fran.output.slice(-800)));
      const files = { settings: join(fran.dataDir, 'settings.json'), cards: join(fran.dataDir, 'cards.json'), presets: join(fran.dataDir, 'presets.json') };
      const dbPath = join(fran.dataDir, 'index.db');

      // ── AC-5: 当たらない本文・クエリは 4xx・書き込みなし・INVALID ──
      const goodSettings = fx('settings.json');
      const goodCards = fx('cards.json');
      const goodPresets = fx('presets.json');
      const negatives = [
        ['S-10 PUT /settings unknown top key', 'PUT', '/settings', { ...goodSettings, extra: 1 }, 'settings'],
        ['S-10 PUT /settings missing guard', 'PUT', '/settings', { generation: goodSettings.generation, captionStyle: goodSettings.captionStyle }, 'settings'],
        ['S-10 PUT /settings steps is a non-numeric string', 'PUT', '/settings', { ...goodSettings, generation: { ...goodSettings.generation, steps: 'abc' } }, 'settings'],
        ['S-10 PUT /settings body is an array', 'PUT', '/settings', [], 'settings'],
        ['S-10 PUT /cards card with unknown field', 'PUT', '/cards', { ...goodCards, cards: [...goodCards.cards, { id: 'c_x', slotId: 's_aaaa1', name: 'x', foo: 'bar' }] }, 'cards'],
        ['S-10 PUT /cards card in a missing slot', 'PUT', '/cards', { ...goodCards, cards: [...goodCards.cards, { id: 'c_x', slotId: 's_missing', name: 'x' }] }, 'cards'],
        ['S-10 PUT /cards slots is not an array', 'PUT', '/cards', { ...goodCards, slots: {} }, 'cards'],
        ['S-10 PUT /presets tags is not an array', 'PUT', '/presets', { ...goodPresets, presets: [{ ...goodPresets.presets[0], tags: 'a,b' }] }, 'presets'],
        ['S-10 PUT /presets unknown top key', 'PUT', '/presets', { ...goodPresets, legacy: true }, 'presets'],
        ['S-11 POST /cards/slot unknown field', 'POST', '/cards/slot', { name: 'New', evil: 1 }, 'cards'],
        ['S-11 PUT /cards/slot/:id non-boolean flag', 'PUT', '/cards/slot/s_bbbb2', { useAsFolder: 'yes' }, 'cards'],
        ['S-11 PUT /cards/card/:id move to a missing slot', 'PUT', '/cards/card/c_00001', { slotId: 's_missing' }, 'cards'],
        ['S-11 PUT /cards/card/:id unknown field', 'PUT', '/cards/card/c_00001', { foo: 'bar' }, 'cards'],
        ['S-11 POST /cards/card unknown field', 'POST', '/cards/card', { slotId: 's_aaaa1', name: 'Z', foo: 1 }, 'cards'],
        ['S-11 PUT /presets/:id unknown field', 'PUT', '/presets/p_00001', { foo: 'bar' }, 'presets'],
        ['S-11 POST /presets cards is not an object', 'POST', '/presets', { name: 'P', cards: 'nope' }, 'presets'],
      ];
      for (const [label, method, path, body, file] of negatives) {
        const before = sha(files[file]);
        const n0 = fran.invalidEntries().length;
        const r = await fran.req(method, path, body);
        const after = sha(files[file]);
        const inv = fran.invalidEntries().slice(n0);
        checks.push(check(`AC-5 ${label}: 4xx`, r.status >= 400 && r.status < 500, `status=${r.status} body=${r.text.slice(0, 200)}`));
        checks.push(check(`AC-5 ${label}: file bytes unchanged`, before === after, `${file} changed`));
        checks.push(check(`AC-5 ${label}: recorded as INVALID`, inv.length > 0 && inv.every(e => e.kind && e.stage && e.raw && e.reason), JSON.stringify(inv).slice(0, 300)));
      }

      const queryNegatives = [
        ['/gallery/recent?limit=-1'], ['/gallery/recent?limit=abc'], ['/gallery/recent?days=-3'],
        ['/gallery/favorites?limit=0'], ['/gallery/search?q=a&limit=-5'], ['/gallery/by-preset/p_00001?limit=abc'],
        ['/gallery/by-card?positive=tag&limit=-1'],
      ];
      for (const [path] of queryNegatives) {
        const before = sha(dbPath);
        const n0 = fran.invalidEntries().length;
        const r = await fran.req('GET', path);
        const inv = fran.invalidEntries().slice(n0);
        checks.push(check(`AC-5 S-12 GET ${path}: 400 and INVALID`, r.status === 400 && inv.length > 0, `status=${r.status} invalid=${inv.length} body=${r.text.slice(0, 150)}`));
        checks.push(check(`AC-5 S-12 GET ${path}: DB unchanged`, before === sha(dbPath), 'index.db changed'));
      }
      {
        const n0 = fran.invalidEntries().length;
        const r = await fran.req('GET', '/gallery/sync-inventory?limit=abc&offset=-2');
        const inv = fran.invalidEntries().slice(n0);
        checks.push(check('AC-5 S-12 sync-inventory (pv-sync caller, J-5): response unchanged (200) but recorded',
          r.status === 200 && r.json?.limit === 100 && r.json?.offset === 0 && inv.length > 0, `status=${r.status} body=${r.text.slice(0, 150)} invalid=${inv.length}`));
      }

      // ── AC-6: 正の対照 ──
      const accept = async (label, method, path, body) => {
        const r = await fran.req(method, path, body);
        checks.push(check(`AC-6 ${label}: accepted`, r.status >= 200 && r.status < 300, `status=${r.status} body=${r.text.slice(0, 300)}`));
        return r;
      };
      // フロントが送る本文
      await accept('front PUT /settings {generation,guard,captionStyle}', 'PUT', '/settings', { generation: goodSettings.generation, guard: goodSettings.guard, captionStyle: goodSettings.captionStyle });
      const cardsNow = (await fran.req('GET', '/cards')).json;
      await accept('front PUT /cards (GenerateScreen slot move: GET then PUT)', 'PUT', '/cards', cardsNow);
      const slot = (await accept('front POST /cards/slot {name}', 'POST', '/cards/slot', { name: 'Front Slot' })).json;
      await accept('front PUT /cards/slot/:id {name}', 'PUT', `/cards/slot/${slot?.id}`, { name: 'Front Slot 2' });
      await accept('front PUT /cards/slot/:id {useInFilename}', 'PUT', `/cards/slot/${slot?.id}`, { useInFilename: true });
      const card = (await accept('front POST /cards/card (ImageViewer/GenerateScreen)', 'POST', '/cards/card', { slotId: 's_aaaa1', name: 'Front Card', positive: 'p', negative: 'n' })).json;
      await accept('front POST /cards/card (TemplateCardEdit payload)', 'POST', '/cards/card', { name: 'Front Card 2', slotId: 's_aaaa1', positive: '', negative: '', parentId: null });
      await accept('front PUT /cards/card/:id (TemplateCardEdit payload)', 'PUT', `/cards/card/${card?.id}`, { name: 'Front Card', slotId: 's_aaaa1', positive: 'p2', negative: '', parentId: 'c_00001' });
      await accept('front PUT /cards/card/:id {positive,negative}', 'PUT', `/cards/card/${card?.id}`, { positive: 'p3', negative: 'n3' });
      const presetBody = { name: 'Front Preset', tags: ['x'], cards: { s_aaaa1: 'c_00001' }, slotOrder: ['s_aaaa1'], folder: 's_aaaa1', filename: ['s_aaaa1'], childCards: { s_aaaa1: null } };
      const preset = (await accept('front POST /presets (TemplatePresetEdit data)', 'POST', '/presets', presetBody)).json;
      checks.push(check('AC-6 POST /presets keeps the fields the front sends (slotOrder/folder/filename/childCards)',
        preset && JSON.stringify(preset.slotOrder) === '["s_aaaa1"]' && preset.folder === 's_aaaa1' && JSON.stringify(preset.childCards) === '{"s_aaaa1":null}', JSON.stringify(preset)));
      await accept('front PUT /presets/:id (TemplatePresetEdit data)', 'PUT', `/presets/${preset?.id}`, { ...presetBody, folder: null });
      // 合成 fixture（実物・Cloud と同じ形）
      await accept('fixture PUT /settings', 'PUT', '/settings', goodSettings);
      await accept('fixture PUT /cards', 'PUT', '/cards', goodCards);
      await accept('fixture PUT /presets', 'PUT', '/presets', goodPresets);
      // Fran の既定値（sync.* キーを含む）
      await accept('Fran DEFAULT_SETTINGS with sync.* keys', 'PUT', '/settings', { ...goodSettings, 'sync.recent_days': 30, 'sync.r2_limit_gb': 5 });
      // いまの Fran の実物（このマシンの data/。リポジトリには置かない）
      for (const [name, path] of [['settings', '/settings'], ['cards', '/cards'], ['presets', '/presets']]) {
        const real = readLocalJson(`data/${name}.json`);
        if (real) await accept(`real Fran data/${name}.json`, 'PUT', path, real);
        else checks.push(notRun(`AC-6 real Fran data/${name}.json`, 'data/ にない（CI 等）'));
      }
      // Cloud 由来の本文（pv-sync handback の形。data/test-fixtures/pv100/ に GET で取得した写し）
      for (const [name, path] of [['settings', '/settings'], ['cards', '/cards'], ['presets', '/presets']]) {
        const cloud = readLocalJson(`data/test-fixtures/pv100/cloud-${name}.json`);
        if (cloud) await accept(`Cloud-origin ${name} (pv-sync handback shape)`, 'PUT', path, cloud);
        else checks.push(notRun(`AC-6 Cloud-origin ${name}`, 'data/test-fixtures/pv100/ にない（CI 等）'));
      }

      // ── AC-7 S-13: 存在しない hash ──
      for (const [label, path, body, expect] of [
        ['favorite', '/gallery/image/0000000000000000/favorite', { favorite: 1 }, 404],
        ['caption', '/gallery/image/0000000000000000/caption', { caption: 'x' }, 404],
        ['meta (J-5: response unchanged)', '/gallery/image/0000000000000000/meta', { preset_id: 'p_00001' }, 200],
      ]) {
        const n0 = fran.invalidEntries().length;
        const r = await fran.req('PUT', path, body);
        const inv = fran.invalidEntries().slice(n0);
        checks.push(check(`AC-7 S-13 ${label} on a missing hash: ${expect} and INVALID`, r.status === expect && inv.length > 0, `status=${r.status} invalid=${inv.length} body=${r.text.slice(0, 150)}`));
      }
      // 正の対照: 実在する hash の favorite・caption は 200
      writeFileSync(join(fran.vault, '.tmp', 'pv100.png'), PNG);
      const saved = await fran.req('POST', '/save', { filename: 'pv100.png', seed: 1, folderSegments: [], filenameSegments: [] });
      const recent = await fran.req('GET', '/gallery/recent?limit=5');
      const hash = recent.json?.images?.[0]?.hash;
      const fav = hash ? await fran.req('PUT', `/gallery/image/${hash}/favorite`, { favorite: 1 }) : null;
      const cap = hash ? await fran.req('PUT', `/gallery/image/${hash}/caption`, { caption: 'hello' }) : null;
      checks.push(check('AC-7 S-13 control: favorite/caption on an existing hash are 200',
        fav?.status === 200 && cap?.status === 200, `save=${saved.status} hash=${hash} fav=${fav?.status} cap=${cap?.status}`));
    } finally {
      await fran.stop();
    }

    // ── AC-7 T-06: 削除するカードの中身全体を集約先に残してから削除 ──
    const t = makeTempRoot('pv100-t06');
    try {
      mkdirSync(join(t, 'scripts'), { recursive: true });
      mkdirSync(join(t, 'server'), { recursive: true });
      mkdirSync(join(t, 'data'), { recursive: true });
      copyFileSync(join(repoRoot, 'scripts', 'normalize-cards.mjs'), join(t, 'scripts', 'normalize-cards.mjs'));
      copyFileSync(join(repoRoot, 'server', 'log.js'), join(t, 'server', 'log.js'));
      const longPositive = 'orphan_tag, '.repeat(200) + 'END_OF_ORPHAN';
      const cards = fx('cards.json');
      cards.cards.push({ id: 'c_orphan', slotId: 's_gone', name: 'Orphan', positive: longPositive, negative: 'orphan_neg', updated_at: '2026-01-01T00:00:00Z' });
      writeFileSync(join(t, 'data', 'cards.json'), JSON.stringify(cards, null, 2));
      const r = spawnSync(process.execPath, [join(t, 'scripts', 'normalize-cards.mjs')], { cwd: t, encoding: 'utf8', timeout: 30000 });
      const after = JSON.parse(readFileSync(join(t, 'data', 'cards.json'), 'utf8'));
      checks.push(check('AC-7 T-06: the orphan card is still removed (deletion rule unchanged)', !after.cards.some(c => c.id === 'c_orphan') && after.cards.length === 3, `exit=${r.status} cards=${after.cards.map(c => c.id)}`));
      const logs = existsSync(join(t, 'logs')) ? readdirSync(join(t, 'logs')).flatMap(f => readFileSync(join(t, 'logs', f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))) : [];
      const rec = logs.find(e => e.code === 'INVALID' && /T-06/.test(e.stage || ''));
      let full = null;
      try { full = JSON.parse(rec?.raw ?? 'null'); } catch {}
      checks.push(check('AC-7 T-06: the whole deleted card is in logs/ as INVALID before deletion',
        !!full && full.id === 'c_orphan' && full.positive === longPositive && full.negative === 'orphan_neg', `rec=${String(JSON.stringify(rec)).slice(0, 300)}\n${(r.stdout + r.stderr).slice(-300)}`));
    } finally {
      removeTempRoot(t);
    }

    // ── AC-7 F-12: vault 鍵 ──
    const store = new MemStore();
    await withGlobals({ localStorage: store }, async () => {
      const crypto = await freshImport('src/lib/crypto.js');
      const log = await freshImport('src/lib/invalidLog.js');
      const secretLike = 'not-base64!!-secretish-value';
      let threw = false;
      try { crypto.setVaultKey(secretLike); } catch { threw = true; }
      checks.push(check('AC-7 F-12: a non-base64 key is not saved', threw && store.getItem('pv-vault-key') === null, `threw=${threw} stored=${store.getItem('pv-vault-key')}`));
      const short = Buffer.alloc(16, 7).toString('base64');
      let threwShort = false;
      try { crypto.setVaultKey(short); } catch { threwShort = true; }
      checks.push(check('AC-7 F-12: a 128-bit key (wrong length) is not saved', threwShort && store.getItem('pv-vault-key') === null, `threw=${threwShort}`));
      const entries = log.getInvalidLog();
      checks.push(check('AC-7 F-12: rejected imports are recorded without the key value (J-3)',
        entries.length >= 2 && !JSON.stringify(entries).includes(secretLike) && !JSON.stringify(entries).includes(short) && entries.every(e => /length=/.test(e.raw)),
        JSON.stringify(entries).slice(0, 400)));
      const good = Buffer.alloc(32, 9).toString('base64');
      let okSave = true;
      try { crypto.setVaultKey(good); } catch { okSave = false; }
      checks.push(check('AC-7 F-12 control: a valid 256-bit base64 key is saved', okSave && JSON.parse(store.getItem('pv-vault-key') || '{}').raw === good, 'valid key not saved'));
      const enc = await crypto.encrypt(new TextEncoder().encode('hello'));
      store.setItem('pv-vault-key', JSON.stringify({ id: 'vault:v2', raw: good }));
      const n0 = log.getInvalidLog().length;
      let plain = null;
      try { plain = new TextDecoder().decode(await crypto.decrypt(enc)); } catch {}
      const mism = log.getInvalidLog().slice(n0).find(e => /key-id/.test(e.kind));
      checks.push(check('AC-7 F-12: a ciphertext keyId different from the local key is recorded (decryption still attempted)',
        !!mism && /vault:v1/.test(mism.raw) && /vault:v2/.test(mism.raw) && plain === 'hello' && !mism.raw.includes(good), JSON.stringify(mism)));
    });

    // ── AC-7 §4.3 #6: 解析できない result のタスクが一覧から永久に外れない ──
    if (!existsSync(join(repoRoot, 'src/lib/queueResult.js'))) {
      checks.push(check('AC-7 #6: task result parser module exists', false, 'src/lib/queueResult.js not found'));
    } else {
      await withGlobals({ localStorage: new MemStore() }, async () => {
        const q = await freshImport('src/lib/queueResult.js');
        const bad = q.parseTaskResult({ id: 't_1', status: 'done', result: '{not json' });
        checks.push(check('AC-7 #6: an unparseable result yields a visible invalid entry (not dropped)',
          bad && bad.invalid === true && bad.task_id === 't_1' && typeof bad.invalidReason === 'string', JSON.stringify(bad)));
        const good = q.parseTaskResult({ id: 't_2', status: 'done', result: '{"filename":"a.png","seed":1,"width":8,"height":8}', folder_segments: '["F"]' });
        checks.push(check('AC-7 #6 control: a parseable result is passed through', good && !good.invalid && good.filename === 'a.png' && good.folderSegments[0] === 'F', JSON.stringify(good)));
      });
    }
    const gen = readFileSync(join(repoRoot, 'src/screens/GenerateScreen.jsx'), 'utf8');
    checks.push(check('AC-7 #6: GenerateScreen no longer returns silently on an unparseable result',
      !/try \{ parsedResult = JSON\.parse\(parsedResult\); \} catch \{ return; \}/.test(gen) && /parseTaskResult\(/.test(gen), 'silent return still present or helper not used'));

    // ── AC-7 §4.3 #11・#12: 失敗がトーストと集約先に出る ──
    const viewer = readFileSync(join(repoRoot, 'src/components/ImageViewer.jsx'), 'utf8');
    const block = (marker) => { const i = viewer.indexOf(marker); return i < 0 ? '' : viewer.slice(i, viewer.indexOf('}, [', i)); };
    for (const [id, marker] of [['#11 favorite', 'const toggleFavorite = useCallback'], ['#12 caption', 'const saveCaption = useCallback']]) {
      const b = block(marker);
      const catchBody = (b.match(/catch \(([^)]*)\) \{([\s\S]*?)\n    \}/) || [])[2] || '';
      checks.push(check(`AC-7 ${id}: failure is recorded and toasted`,
        /recordInvalid|recordFailure/.test(catchBody) && /addToast\(\s*'error'/.test(catchBody), `catch body=${catchBody.slice(0, 200) || '(silent)'}`));
    }

    return checks;
  },
};
