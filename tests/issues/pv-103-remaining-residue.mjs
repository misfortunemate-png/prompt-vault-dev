// pv#103: 残りの握りつぶし・振り分けに残余の型を持たせる（軽微・J-17）
import { readFileSync, existsSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { startFran, runFranUntilExit, repoRoot } from './lib/fran-harness.mjs';
import { MemStore, freshImport, withGlobals, check } from './lib/front-env.mjs';

const settle = () => new Promise(r => setTimeout(r, 80));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const src = (p) => readFileSync(join(repoRoot, p), 'utf8');

// 1x1 の PNG にテキストチャンクを足す（CRC 付き）
const BASE_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f20000000049454e44ae426082', 'hex');
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function pngWith(...chunks) {
  const ihdrEnd = 8 + 25; // signature + IHDR chunk
  return Buffer.concat([BASE_PNG.subarray(0, ihdrEnd), ...chunks, BASE_PNG.subarray(ihdrEnd)]);
}
const tEXt = (k, v) => chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'utf8')]));
const zTXt = (k, v) => chunk('zTXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0, 0]), deflateSync(Buffer.from(v, 'utf8'))]));
const iTXtCompressed = (k, v) => chunk('iTXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0, 1, 0]), Buffer.from([0]), Buffer.from([0]), deflateSync(Buffer.from(v, 'utf8'))]));

async function waitScan(fran, ms = 20000) {
  const end = Date.now() + ms;
  await sleep(200);
  while (Date.now() < end) {
    const s = (await fran.req('GET', '/rescan/status')).json;
    if (s && !s.scanning) return s;
    await sleep(200);
  }
  return null;
}

export default {
  issue: 'pv#103',
  title: 'Remaining swallowed failures and branches have a residue type (light)',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-103-remaining-residue.mjs',

  async verify() {
    const checks = [];

    // ── サーバ: S-06・S-07・S-08・S-09・S-12・S-17・S-20・S-21・S-22 ──
    const csv = ['tag_a,0,100', 'short_row,1', ',0,5', 'tag_b,0,abc', 'tag_c,0,7'].join('\n');
    const fran = await startFran({
      name: 'pv103',
      files: { 'docs/supplied/danbooru-filtered.csv': csv },
      vaultFiles: {
        'presets.json': '{ not json',
        'A/bad-comment.png': pngWith(tEXt('Comment', '{not json')),
        'A/ztxt.png': pngWith(zTXt('Description', 'compressed prompt')),
        'A/itxt.png': pngWith(iTXtCompressed('Comment', '{"prompt":"x"}')),
        'A/software.png': pngWith(tEXt('Software', 'NovelAI')),
        'A/garbage.png': Buffer.from('this is not a png at all'),
      },
    });
    try {
      checks.push(check('Fran test instance starts', fran.up, fran.output.slice(-600)));
      const s = await waitScan(fran);
      const inv = () => fran.invalidEntries();
      const by = (re) => inv().filter(e => re.test(e.stage));

      // S-06
      const s06 = by(/S-06/);
      checks.push(check('AC-13 S-06: Comment JSON that cannot be parsed is recorded', s06.some(e => /bad-comment/.test(e.raw) && /Comment/.test(e.raw)), JSON.stringify(s06).slice(0, 400)));
      checks.push(check('AC-13 S-06: zTXt Description is recorded', s06.some(e => /ztxt\.png/.test(e.raw) && /zTXt/.test(e.raw)), JSON.stringify(s06).slice(0, 400)));
      checks.push(check('AC-13 S-06: compressed iTXt Comment is recorded', s06.some(e => /itxt\.png/.test(e.raw) && /iTXt/.test(e.raw)), JSON.stringify(s06).slice(0, 400)));
      checks.push(check('AC-13 S-06 (J-17): other keywords are skipped explicitly, not recorded', !s06.some(e => /software\.png/.test(e.raw)), JSON.stringify(s06).slice(0, 400)));
      checks.push(check('AC-13 S-06: a non-PNG .png file is recorded', s06.some(e => /garbage\.png/.test(e.raw)), JSON.stringify(s06).slice(0, 400)));
      // S-07・S-08
      checks.push(check('AC-13 S-08: a thumbnail failure is recorded in logs/ (not console only)', by(/S-08/).some(e => /garbage/.test(e.raw)), JSON.stringify(by(/S-08/)).slice(0, 300)));
      checks.push(check('AC-13 S-07: scan finished and status still exposes incomplete', !!s && typeof s.incomplete === 'boolean', JSON.stringify(s)));
      // S-09
      writeFileSync(join(fran.vault, '.tmp', 'a.png'), BASE_PNG);
      const n9 = inv().length;
      const r9 = await fran.req('POST', '/save', { filename: 'a.png', seed: null, folderSegments: [123], filenameSegments: [] });
      const s09 = inv().slice(n9).filter(e => /S-09/.test(e.stage));
      checks.push(check('AC-13 S-09: folding seed null → 0000000000 and a non-string segment are recorded, save unchanged (200)',
        r9.status === 200 && s09.some(e => /seed/.test(e.raw)) && s09.some(e => /123/.test(e.raw)), `status=${r9.status} s09=${JSON.stringify(s09).slice(0, 300)}`));
      // S-12（pv#100 で 400 化済み。ここでも確かめる）
      const r12 = await fran.req('GET', '/gallery/recent?limit=abc');
      checks.push(check('AC-13 S-12: limit=abc is 400 and recorded', r12.status === 400 && by(/S-12/).length > 0, `status=${r12.status}`));
      // S-21
      const s21 = by(/S-21/);
      checks.push(check('AC-13 S-21: skipped CSV rows and unparseable counts are recorded with samples',
        s21.some(e => /short_row/.test(e.raw)) && s21.some(e => /tag_b/.test(e.raw)), JSON.stringify(s21).slice(0, 400)));
      // S-22
      const s22 = by(/S-22/);
      checks.push(check('AC-13 S-22: an unparseable M2 presets.json is recorded (migration behavior unchanged)', s22.length > 0 && !existsSync(join(fran.vault, '.m3-migrated')), JSON.stringify(s22).slice(0, 300)));
      // S-17（pv#98 で記録化済み）・S-20
      const today = new Date().toISOString().slice(0, 10);
      appendFileSync(join(fran.logDir, `${today}.log`), 'NOT JSON LINE 103\n');
      const d = await fran.req('GET', '/debug/errors');
      checks.push(check('AC-13 S-20: an unparseable log line is returned as INVALID', Array.isArray(d.json) && d.json.some(e => e.code === 'INVALID' && /NOT JSON LINE 103/.test(e.raw)), d.text.slice(0, 200)));
    } finally {
      await fran.stop();
    }
    {
      // cards.json・presets.json は起動時に読むため（壊れていると起動しない・従来どおり）、要求時に読む settings.json で確かめる
      const f17 = await startFran({ name: 'pv103s17', data: { 'settings.json': '{"guard": [' } });
      try {
        const r = await f17.req('GET', '/settings');
        checks.push(check('AC-13 S-17: a corrupted settings.json is recorded (response unchanged 500)', r.status === 500 && f17.invalidEntries().some(e => /S-17/.test(e.stage)), `status=${r.status}`));
      } finally { await f17.stop(); }
    }

    // ── S-16: .env・PORT・VAULT_ROOT ──
    {
      const r = await runFranUntilExit({ name: 'pv103port', env: { PORT: 'abc' } });
      checks.push(check('AC-13 S-16: a non-numeric PORT stops startup with a reason',
        !r.started && r.exited !== 0 && r.exited !== null && /PORT/.test(r.output) && /abc/.test(r.output), `started=${r.started} exit=${r.exited} out=${r.output.slice(-300)}`));
    }
    {
      // 起動時に従来どおり .tmp ごと作られるので、毎回まだない一意のパスを使い、終わったら消す
      const missingRoot = join(tmpdir(), `pv95-missing-vault-${Date.now()}`);
      const f16 = await startFran({ name: 'pv103env', envFile: 'GARBAGE_LINE_WITHOUT_EQUALS\nFOO=bar\n', env: { VAULT_ROOT: missingRoot } });
      try {
        const e16 = f16.invalidEntries().filter(e => /S-16/.test(e.stage));
        checks.push(check('AC-13 S-16: startable residue (.env line without =, missing VAULT_ROOT) is recorded and startup continues',
          f16.up && e16.some(e => /line 1/.test(e.raw)) && e16.some(e => /VAULT_ROOT/.test(e.reason + e.raw)), `up=${f16.up} e16=${JSON.stringify(e16).slice(0, 300)}`));
        checks.push(check('AC-13 S-16 (J-3): the content of a line without = is not copied into raw', !JSON.stringify(e16).includes('GARBAGE_LINE_WITHOUT_EQUALS'), 'line content leaked'));
      } finally {
        await f16.stop();
        try { rmSync(missingRoot, { recursive: true, force: true }); } catch {}
      }
    }

    // ── フロント（lib の振る舞い）: #21・#27 ──
    {
      const store = new MemStore({ 'pv-connection': JSON.stringify({ route: 'cloud', manual: true, lastCheck: null, token: 't', revision: 'r', cloudOfflineReason: null }) });
      const fetch = async () => ({ ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
      await withGlobals({ localStorage: store, fetch, document: { addEventListener() {}, removeEventListener() {} } }, async () => {
        const log = await freshImport('src/lib/invalidLog.js');
        const { api } = await freshImport('src/lib/api.js');
        const r = await api.getThumb('abc123');
        await settle();
        checks.push(check('AC-13 §4.3 #21: getThumb failure returns null and is recorded', r === null && log.getInvalidLog().some(e => /#21/.test(e.stage) && /500/.test(e.raw)), JSON.stringify(log.getInvalidLog()).slice(0, 300)));
      });
    }
    await withGlobals({ localStorage: new MemStore(), indexedDB: undefined }, async () => {
      const log = await freshImport('src/lib/invalidLog.js');
      const db = await freshImport('src/lib/thumbDb.js');
      const r = await db.getThumb('h');
      await db.putThumb('h', new Uint8Array([1]));
      checks.push(check('AC-13 §4.3 #27: IndexedDB failures return the empty result and are recorded', r === null && log.getInvalidLog().filter(e => /#27/.test(e.stage)).length >= 2, JSON.stringify(log.getInvalidLog()).slice(0, 300)));
    });

    // ── フロント（画面: 静的）──
    const expect = [
      ['§4.3 #3', 'src/screens/GenerateScreen.jsx', /§4\.3 #3\b/, /api\.getPresets\(\)\.then\(pd => setPresetsData\(pd\)\)\.catch\(\(\) => \{\}\)/],
      ['§4.3 #4', 'src/screens/GenerateScreen.jsx', /§4\.3 #4\b/, null],
      ['§4.3 #9', 'src/screens/GenerateScreen.jsx', /§4\.3 #9\b/, /uploadThumbAfterSave\([^)]*\)\.catch\(\(\) => \{\}\)/],
      ['§4.3 #10', 'src/lib/thumbGen.js', /§4\.3 #10\b/, null],
      ['§4.3 #13', 'src/components/ImageViewer.jsx', /§4\.3 #13\b/, /\.catch\(\(\) => \{ if \(!cancelled\) setImgLoading\(false\); \}\)/],
      ['§4.3 #14', 'src/components/ImageViewer.jsx', /§4\.3 #14\b/, null],
      ['§4.3 #15', 'src/screens/AlbumScreen.jsx', /§4\.3 #15\b/, null],
      ['§4.3 #16', 'src/screens/AlbumScreen.jsx', /§4\.3 #16\b/, /putThumb\(image\.hash, plain\)\.catch\(\(\) => \{\}\)/],
      ['§4.3 #17', 'src/screens/AlbumScreen.jsx', /§4\.3 #17\b/, null],
      ['§4.3 #18', 'src/screens/AlbumScreen.jsx', /§4\.3 #18\b/, /if \(!e\.message\?\.includes\('400'\)\)/],
      ['§4.3 #19', 'src/screens/AlbumScreen.jsx', /§4\.3 #19\b/, null],
      ['§4.3 #20 (cards)', 'src/screens/TemplateCardList.jsx', /§4\.3 #20\b/, null],
      ['§4.3 #20 (presets)', 'src/screens/TemplatePresetList.jsx', /§4\.3 #20\b/, null],
      ['§4.3 #22 (cards)', 'src/screens/TemplateCardList.jsx', /§4\.3 #22\b/, null],
      ['§4.3 #22 (presets)', 'src/screens/TemplatePresetList.jsx', /§4\.3 #22\b/, null],
      ['§4.3 #23', 'src/components/TagSuggest.jsx', /§4\.3 #23\b/, null],
      ['§4.3 #24', 'src/App.jsx', /§4\.3 #24\b/, null],
      ['§4.3 #25', 'src/App.jsx', /§4\.3 #25\b/, /checkReachability\(\)\.then\(setConnectionState\)\.catch\(\(\) => \{\}\)/],
      ['§4.3 #26', 'src/screens/SettingsScreen.jsx', /§4\.3 #26\b/, /api\.getSystemInfo\(\)\.then\(setSystemInfo\)\.catch\(\(\) => \{\}\)/],
      ['F-14', 'src/App.jsx', /F-14/, null],
      ['F-15 (cards)', 'src/screens/TemplateCardList.jsx', /F-15/, null],
      ['F-15 (presets)', 'src/screens/TemplatePresetList.jsx', /F-15/, null],
      ['F-16 (sw)', 'public/sw.js', /F-16/, null],
      ['F-16 (client)', 'src/main.jsx', /F-16/, null],
      ['F-17', 'src/screens/GenerateScreen.jsx', /F-17/, null],
      ['F-18', 'src/App.jsx', /F-18/, null],
      ['S-07 (front reads incomplete)', 'src/screens/AlbumScreen.jsx', /incomplete/, null],
    ];
    for (const [id, file, mustHave, mustNot] of expect) {
      const s = src(file);
      checks.push(check(`AC-13 ${id}: recorded / handled in ${file}`, mustHave.test(s) && (!mustNot || !mustNot.test(s)), mustNot && mustNot.test(s) ? 'silent pattern remains' : 'marker missing'));
    }
    checks.push(check('AC-13 F-18 (J-17): resolveResultsOwner stays pure (offline keeps the owner; unknown is reported to the caller)',
      /function resolveResultsOwner[\s\S]*?unknownRoute/.test(src('src/App.jsx')), 'unknownRoute flag missing'));

    return checks;
  },
};

