// pv#101: 生成・キューで未知の値を寄せない（J-9・J-10）。NovelAI はモック（実際には呼ばない）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFran, repoRoot } from './lib/fran-harness.mjs';
import { MemStore, freshImport, withGlobals, check } from './lib/front-env.mjs';

const SETTINGS = JSON.parse(readFileSync(join(repoRoot, 'tests/issues/fixtures/pv100/settings.json'), 'utf8'));
const MODELS = ['nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-4-full', 'nai-diffusion-3'];
const SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2m_sde'];
const RESOLUTIONS = [[832, 1216], [1216, 832], [1024, 1024]];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// いまのフロントが送る本文（GenerateScreen handleGenerate・buildSingleTask の形）
const frontGenerate = (o = {}) => ({
  prompt: 'tag_a, tag_b', negative_prompt: 'lowres', model: 'nai-diffusion-4-5-full', width: 832, height: 1216,
  steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: null, folderSegments: ['A'], filenameSegments: ['B'], preset_id: null, ...o,
});
const frontTask = (params = {}, o = {}) => ({
  positive: 'tag_a', negative: 'lowres',
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: null, ...params },
  folderSegments: ['A'], filenameSegments: ['B'], preset_id: null, label: 'A × B', ...o,
});

async function waitQueue(fran, pred, ms = 15000) {
  const end = Date.now() + ms;
  let q;
  while (Date.now() < end) {
    q = (await fran.req('GET', '/queue')).json;
    if (q && pred(q)) return q;
    await sleep(150);
  }
  return q;
}

export default {
  issue: 'pv#101',
  title: 'Paid NovelAI calls are not made with unmatched values; failure kinds are recorded on both paths',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-101-paid-call-guard.mjs',

  async verify() {
    const checks = [];

    // ── AC-8: S-03・S-04・S-19 ──
    const a = await startFran({ name: 'pv101a', data: { 'settings.json': SETTINGS } });
    try {
      checks.push(check('Fran test instance starts', a.up, a.output.slice(-600)));
      const negatives = [
        ['S-03 unknown model', { model: 'nai-diffusion-9-unknown' }],
        ['S-04 width non-numeric string', { width: 'abc' }],
        ['S-04 width 0', { width: 0 }],
        ['S-04 width not a multiple of 64', { width: 833 }],
        ['S-04 steps 0', { steps: 0 }],
        ['S-04 steps 60', { steps: 60 }],
        ['S-04 unknown sampler', { sampler: 'k_unknown' }],
        ['S-04 scale as string', { scale: '5' }],
        ['S-04 negative seed other than -1', { seed: -5 }],
        ['S-04 fractional seed', { seed: 1.5 }],
        ['S-04 prompt not a string', { prompt: 123 }],
        ['S-04 unknown body key', { foo: 1 }],
      ];
      for (const [label, patch] of negatives) {
        const calls0 = a.novelAiCalls().length;
        const n0 = a.invalidEntries().length;
        const r = await a.req('POST', '/generate', frontGenerate(patch));
        const inv = a.invalidEntries().slice(n0);
        checks.push(check(`AC-8 ${label}: rejected with 4xx`, r.status >= 400 && r.status < 500, `status=${r.status} body=${r.text.slice(0, 200)}`));
        checks.push(check(`AC-8 ${label}: NovelAI (mock) not called`, a.novelAiCalls().length === calls0, `calls ${calls0} -> ${a.novelAiCalls().length}`));
        checks.push(check(`AC-8 ${label}: recorded as INVALID`, inv.length > 0, JSON.stringify(inv).slice(0, 200)));
      }

      // 未指定は既定値で通る
      for (const [label, body] of [
        ['only prompt', { prompt: 'x' }],
        ['null / empty values', { prompt: 'x', width: null, height: null, steps: '', scale: null, sampler: '', model: null, seed: null }],
      ]) {
        const calls0 = a.novelAiCalls().length;
        const r = await a.req('POST', '/generate', body);
        const call = a.novelAiCalls()[calls0];
        const p = call?.parameters || {};
        checks.push(check(`AC-8 unspecified (${label}) uses defaults and calls once`,
          r.status === 200 && a.novelAiCalls().length === calls0 + 1 && call.model === 'nai-diffusion-4-5-full'
          && p.width === 832 && p.height === 1216 && p.steps === 28 && p.scale === 5 && p.sampler === 'k_euler_ancestral',
          `status=${r.status} call=${JSON.stringify(call)?.slice(0, 300)}`));
      }

      // 正の対照（J-9）: フロントの選択肢すべて
      const ok = async (label, body) => {
        const calls0 = a.novelAiCalls().length;
        const r = await a.req('POST', '/generate', body);
        checks.push(check(`AC-8 control ${label}: accepted and called once`, r.status === 200 && a.novelAiCalls().length === calls0 + 1, `status=${r.status} body=${r.text.slice(0, 200)}`));
      };
      for (const m of MODELS) await ok(`model ${m}`, frontGenerate({ model: m }));
      for (const s of SAMPLERS) await ok(`sampler ${s}`, frontGenerate({ sampler: s }));
      for (const [w, h] of RESOLUTIONS) await ok(`resolution ${w}x${h}`, frontGenerate({ width: w, height: h }));
      await ok('seed -1', frontGenerate({ seed: -1 }));
      await ok('seed 4294967295', frontGenerate({ seed: 4294967295 }));
      await ok('settings default model (fixture)', frontGenerate({ model: SETTINGS.generation.model, steps: SETTINGS.generation.steps, scale: SETTINGS.generation.scale, sampler: SETTINGS.generation.sampler }));

      // S-19: キュー追加
      for (const [label, tasks] of [
        ['unknown model in params', [frontTask({ model: 'bad-model' })]],
        ['unknown task field', [frontTask({}, { extra: 1 })]],
        ['steps as string', [frontTask({ steps: 'x' })]],
        ['folderSegments not an array', [frontTask({}, { folderSegments: 'A' })]],
        ['unknown params key', [frontTask({ cfg: 1 })]],
      ]) {
        const n0 = a.invalidEntries().length;
        const r = await a.req('POST', '/queue/add', { tasks });
        const q = (await a.req('GET', '/queue')).json;
        checks.push(check(`AC-8 S-19 ${label}: 4xx, nothing queued, recorded`,
          r.status >= 400 && r.status < 500 && q?.tasks?.length === 0 && a.invalidEntries().length > n0, `status=${r.status} tasks=${q?.tasks?.length} body=${r.text.slice(0, 200)}`));
      }
      const addOk = await a.req('POST', '/queue/add', { tasks: [frontTask(), frontTask({ seed: 7 }, { label: '' })] });
      checks.push(check('AC-8 S-19 control: front task shapes are queued', addOk.status === 200 && addOk.json?.added === 2, `status=${addOk.status} body=${addOk.text.slice(0, 200)}`));
    } finally {
      await a.stop();
    }

    // ── AC-9: S-18 ガード値 ──
    for (const [label, guard] of [
      ['intervalMin is a string', { intervalMin: 'abc', intervalMax: 5, maxPerJob: 100 }],
      ['intervalMax below intervalMin', { intervalMin: 5, intervalMax: 2, maxPerJob: 100 }],
      ['intervalMin negative', { intervalMin: -1, intervalMax: 5, maxPerJob: 100 }],
    ]) {
      const b = await startFran({ name: 'pv101b', data: { 'settings.json': SETTINGS } });
      try {
        const add = await b.req('POST', '/queue/add', { tasks: [frontTask(), frontTask()] });
        writeFileSync(join(b.dataDir, 'settings.json'), JSON.stringify({ ...SETTINGS, guard }, null, 2));
        const n0 = b.invalidEntries().length;
        const start = await b.req('POST', '/queue/start');
        await sleep(600);
        const q = (await b.req('GET', '/queue')).json;
        const inv = b.invalidEntries().slice(n0);
        checks.push(check(`AC-9 S-18 ${label}: queue is not started`,
          add.status === 200 && start.status >= 400 && q?.state !== 'running' && q?.tasks?.every(t => t.status === 'pending'),
          `add=${add.status} start=${start.status} state=${q?.state} statuses=${q?.tasks?.map(t => t.status)}`));
        checks.push(check(`AC-9 S-18 ${label}: NovelAI (mock) not called`, b.novelAiCalls().length === 0, `calls=${b.novelAiCalls().length}`));
        checks.push(check(`AC-9 S-18 ${label}: reason on screen (response) and in the aggregator`,
          /ガード|guard/i.test(start.text) && inv.some(e => /S-18/.test(e.stage)), `body=${start.text.slice(0, 200)} inv=${JSON.stringify(inv).slice(0, 200)}`));
      } finally {
        await b.stop();
      }
    }

    // ── AC-10: S-01・S-02・S-05（単発・キューの両方。再試行しない） ──
    const c = await startFran({ name: 'pv101c', data: { 'settings.json': { ...SETTINGS, guard: { intervalMin: 1, intervalMax: 1, maxPerJob: 100 } } }, env: { NOVELAI_API_KEY: 'test-api-key' } });
    try {
      const expectKinds = [
        ['status:401', 'novelai-auth'], ['status:402', 'novelai-payment'], ['status:429', 'novelai-rate-limit'],
        ['status:503', 'novelai-server-error'], ['status:418', 'novelai-unexpected-status'],
        ['html', 'novelai-response-format'], ['throw', 'novelai-network'],
      ];
      const seen = [];
      for (const [mode, kind] of expectKinds) {
        c.setNovelAiMode(mode);
        const calls0 = c.novelAiCalls().length;
        const n0 = c.logEntries().length;
        const r = await c.req('POST', '/generate', frontGenerate());
        const added = c.logEntries().slice(n0);
        const hit = added.find(e => e.kind === kind && /single|単発/.test(e.stage || ''));
        seen.push(hit?.kind);
        checks.push(check(`AC-10 single ${mode}: recorded with kind ${kind}`, r.status >= 400 && !!hit, `status=${r.status} added=${JSON.stringify(added).slice(0, 300)}`));
        checks.push(check(`AC-10 single ${mode}: no retry (called exactly once)`, c.novelAiCalls().length === calls0 + 1, `calls ${calls0} -> ${c.novelAiCalls().length}`));
        if (mode.startsWith('status:')) checks.push(check(`AC-10 single ${mode}: raw keeps the status and body head`, !!hit && hit.raw.includes(mode.slice(7)) && hit.raw.includes('mock error body'), hit?.raw));
        if (mode === 'html') checks.push(check('AC-10 S-02: raw keeps Content-Type and the head of the body', !!hit && /text\/html/.test(hit.raw) && /doctype/i.test(hit.raw), hit?.raw));
      }
      checks.push(check('AC-10: kinds are all distinct', new Set(seen.filter(Boolean)).size === expectKinds.length, JSON.stringify(seen)));

      // キュー経路
      c.setNovelAiMode('status:429');
      await c.req('POST', '/queue/add', { tasks: [frontTask()] });
      const n0 = c.logEntries().length;
      await c.req('POST', '/queue/start');
      const q = await waitQueue(c, x => x.state !== 'running');
      const added = c.logEntries().slice(n0);
      checks.push(check('AC-10 queue 429: recorded in the aggregator (not only task.error)',
        added.some(e => e.kind === 'novelai-rate-limit' && /queue|キュー/.test(e.stage || '')), `state=${q?.state} added=${JSON.stringify(added).slice(0, 300)}`));

      // S-05 /debug/test-api
      c.setNovelAiMode('status:429');
      const m0 = c.logEntries().length;
      await c.req('POST', '/debug/test-api');
      const t429 = c.logEntries().slice(m0);
      checks.push(check('AC-10 S-05: test-api 429 is recorded as rate-limit, not API_AUTH_FAILED',
        t429.some(e => e.kind === 'novelai-rate-limit') && !t429.some(e => e.code === 'API_AUTH_FAILED'), JSON.stringify(t429).slice(0, 300)));
      c.setNovelAiMode('status:401');
      const m1 = c.logEntries().length;
      await c.req('POST', '/debug/test-api');
      const t401 = c.logEntries().slice(m1);
      checks.push(check('AC-10 S-05 control: test-api 401 keeps API_AUTH_FAILED (existing code)', t401.some(e => e.code === 'API_AUTH_FAILED'), JSON.stringify(t401).slice(0, 300)));
    } finally {
      await c.stop();
    }

    // ── AC-10 F-08: いまの Worker の値は残余にならない・未知の値は記録 ──
    if (!existsSync(join(repoRoot, 'src/lib/queueStatus.js'))) {
      checks.push(check('AC-10 F-08: queue status module exists', false, 'src/lib/queueStatus.js not found'));
    } else {
      await withGlobals({ localStorage: new MemStore() }, async () => {
        const s = await freshImport('src/lib/queueStatus.js');
        const log = await freshImport('src/lib/invalidLog.js');
        for (const st of ['idle', 'running', 'paused']) s.checkQueueState(st);
        for (const st of ['pending', 'running', 'done', 'error', 'skipped']) s.checkTaskStatus(st, 't_x');
        checks.push(check('AC-10 F-08: Worker values (state idle/running/paused, status pending/running/done/error, skipped) are not residue',
          log.getInvalidLog().length === 0, JSON.stringify(log.getInvalidLog())));
        s.checkQueueState('draining');
        s.checkTaskStatus('zombie', 't_y');
        const inv = log.getInvalidLog();
        checks.push(check('AC-10 F-08: unknown state/status are recorded with the raw value',
          inv.some(e => e.raw.includes('draining')) && inv.some(e => e.raw.includes('zombie')), JSON.stringify(inv)));
      });
    }

    // ── AC-10 F-09・§4.3 #1・#2・#5・#7・#8: 握りつぶしをやめ、集約先に残す ──
    const gen = readFileSync(join(repoRoot, 'src/screens/GenerateScreen.jsx'), 'utf8');
    for (const [id, re] of [['§4.3 #1', /§4\.3 #1\b/], ['§4.3 #2', /§4\.3 #2\b/], ['§4.3 #5', /§4\.3 #5\b/], ['§4.3 #7', /§4\.3 #7\b/], ['§4.3 #8', /§4\.3 #8\b/], ['F-09', /F-09/]]) {
      checks.push(check(`AC-10 ${id}: GenerateScreen records the residue`, re.test(gen) && /recordInvalid/.test(gen), `${id} stage not found`));
    }
    // F-08 の段名は src/lib/queueStatus.js にある。GenerateScreen はそこを通して振り分ける
    checks.push(check('AC-10 F-08: GenerateScreen classifies task status and queue state via queueStatus',
      /checkTaskStatus\(task\.status/.test(gen) && /checkQueueState\(queueData\.state\)/.test(gen), 'checkTaskStatus/checkQueueState not used'));
    checks.push(check('AC-10 #1/#7/#8: no silent catch around the task image fetch',
      !/\.catch\(\(\) => \{\}\);\s*\n\s*return \(\) => \{ cancelled = true/.test(gen) && !/fetchTaskImage\([^)]*\)[\s\S]{0,400}?\} catch \{\}/.test(gen), 'silent catch remains'));
    checks.push(check('AC-10 #5: queue polling failure is not silent', !/try \{ const d = await api\.getQueue\(\); setQueueData\(d\); \} catch \{\}/.test(gen), 'silent polling catch remains'));
    checks.push(check('AC-10 #2: QueueTaskRow does not fold an unparseable result into null silently', !/try \{ return JSON\.parse\(task\.result\); \} catch \{ return null; \}/.test(gen), 'silent parse remains'));

    return checks;
  },
};
