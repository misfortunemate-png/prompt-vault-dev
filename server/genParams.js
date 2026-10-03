// 生成パラメータ・キュータスクの検査（pv#101・J-9）
// 当たる枝: フロントの選択肢（MODELS・SAMPLERS・RESOLUTIONS）と入力欄の範囲。
// 未指定（undefined・null・空文字）だけ既定値を使う。指定されたが当たらない値は NovelAI を呼ばずに拒む

export const KNOWN_MODELS = [
  'nai-diffusion-5-full', 'nai-diffusion-5-curated',
  'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated',
  'nai-diffusion-4-full', 'nai-diffusion-3',
];
export const KNOWN_SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2m_sde'];
export const GEN_DEFAULTS = { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral' };

export class InvalidInputError extends Error {
  constructor(stage, problems, raw) {
    super(problems.slice(0, 5).map(p => `${p.path}: ${p.reason}`).join(' / '));
    this.name = 'InvalidInputError';
    this.invalid = true;
    this.stage = stage;
    this.problems = problems;
    this.raw = raw;
  }
}

const unspecified = v => v === undefined || v === null || v === '';
const describe = v => { if (v === undefined) return 'undefined'; try { return JSON.stringify(v); } catch { return String(v); } };
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

const PARAM_RULES = {
  model: [v => KNOWN_MODELS.includes(v), `${KNOWN_MODELS.join('・')} のどれか`],
  width: [v => Number.isInteger(v) && v >= 64 && v <= 2048 && v % 64 === 0, '64〜2048 の 64 の倍数'],
  height: [v => Number.isInteger(v) && v >= 64 && v <= 2048 && v % 64 === 0, '64〜2048 の 64 の倍数'],
  steps: [v => Number.isInteger(v) && v >= 1 && v <= 50, '1〜50 の整数'],
  scale: [v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10, '0〜10 の数'],
  sampler: [v => KNOWN_SAMPLERS.includes(v), `${KNOWN_SAMPLERS.join('・')} のどれか`],
  seed: [v => v === -1 || (Number.isInteger(v) && v >= 0 && v <= 4294967295), '-1 か 0〜4294967295 の整数'],
};

// params: { model, width, height, steps, scale, sampler, seed } → 既定値を埋めた値か、problems
export function resolveGenParams(params, path = 'params') {
  const problems = [];
  const out = {};
  for (const [k, [pred, expect]] of Object.entries(PARAM_RULES)) {
    const v = params?.[k];
    if (unspecified(v)) {
      out[k] = k === 'seed' ? null : GEN_DEFAULTS[k];
    } else if (!pred(v)) {
      problems.push({ path: `${path}.${k}`, raw: describe(v), reason: `${expect}でない` });
    } else {
      out[k] = k === 'seed' ? (v === -1 ? null : v) : v;
    }
  }
  return { problems, params: out };
}

const GENERATE_BODY_KEYS = ['prompt', 'negative_prompt', 'model', 'width', 'height', 'steps', 'scale', 'sampler', 'seed', 'folderSegments', 'filenameSegments', 'preset_id'];

// POST /generate の本文（フロントは folderSegments・filenameSegments・preset_id も送る。Fran の単発生成では使わない）
export function checkGenerateBody(body) {
  const problems = [];
  if (!isObj(body)) return { problems: [{ path: 'body', raw: describe(body), reason: 'オブジェクトでない' }] };
  for (const k of Object.keys(body)) if (!GENERATE_BODY_KEYS.includes(k)) problems.push({ path: `body.${k}`, raw: describe(body[k]), reason: '未知のキー' });
  for (const k of ['prompt', 'negative_prompt']) if (!unspecified(body[k]) && typeof body[k] !== 'string') problems.push({ path: `body.${k}`, raw: describe(body[k]), reason: '文字列でない' });
  const r = resolveGenParams(body, 'body');
  problems.push(...r.problems);
  return { problems, params: r.params };
}

const TASK_KEYS = ['positive', 'negative', 'params', 'folderSegments', 'filenameSegments', 'preset_id', 'label'];
const PARAM_KEYS = Object.keys(PARAM_RULES);

// S-19: キュー追加のタスク
export function checkQueueTasks(tasks) {
  const problems = [];
  tasks.forEach((t, i) => {
    const p = `tasks[${i}]`;
    if (!isObj(t)) { problems.push({ path: p, raw: describe(t), reason: 'オブジェクトでない' }); return; }
    for (const k of Object.keys(t)) if (!TASK_KEYS.includes(k)) problems.push({ path: `${p}.${k}`, raw: describe(t[k]), reason: '未知のキー' });
    for (const k of ['positive', 'negative', 'label']) if (!unspecified(t[k]) && typeof t[k] !== 'string') problems.push({ path: `${p}.${k}`, raw: describe(t[k]), reason: '文字列でない' });
    for (const k of ['folderSegments', 'filenameSegments']) {
      if (!unspecified(t[k]) && !(Array.isArray(t[k]) && t[k].every(s => typeof s === 'string'))) problems.push({ path: `${p}.${k}`, raw: describe(t[k]), reason: '文字列の配列でない' });
    }
    if (!unspecified(t.preset_id) && typeof t.preset_id !== 'string') problems.push({ path: `${p}.preset_id`, raw: describe(t.preset_id), reason: '文字列でない' });
    if (!unspecified(t.params)) {
      if (!isObj(t.params)) problems.push({ path: `${p}.params`, raw: describe(t.params), reason: 'オブジェクトでない' });
      else {
        for (const k of Object.keys(t.params)) if (!PARAM_KEYS.includes(k)) problems.push({ path: `${p}.params.${k}`, raw: describe(t.params[k]), reason: '未知のキー' });
        problems.push(...resolveGenParams(t.params, `${p}.params`).problems);
      }
    }
  });
  return problems;
}

// S-18: キューのガード値。設定ファイルがない・guard がない・各値が未指定なら既定値。
// 解析できない・型違い・範囲外・intervalMax < intervalMin は当たらない（既定値で走らせない）
export const GUARD_DEFAULTS = { intervalMin: 2, intervalMax: 5, maxPerJob: 100 };
export function checkGuard(settingsText) {
  if (settingsText == null) return { ok: true, guard: { ...GUARD_DEFAULTS } };
  let s;
  try { s = JSON.parse(settingsText); } catch (e) { return { ok: false, raw: settingsText.slice(0, 300), reason: `settings.json を解析できない: ${e.message}` }; }
  const g = s?.guard;
  if (unspecified(g)) return { ok: true, guard: { ...GUARD_DEFAULTS } };
  if (!isObj(g)) return { ok: false, raw: describe(g), reason: 'guard がオブジェクトでない' };
  const out = {};
  const rules = {
    intervalMin: [v => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 3600, '1〜3600 の数'],
    intervalMax: [v => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 3600, '1〜3600 の数'],
    maxPerJob: [v => Number.isInteger(v) && v >= 1 && v <= 500, '1〜500 の整数'],
  };
  for (const [k, [pred, expect]] of Object.entries(rules)) {
    if (unspecified(g[k])) out[k] = GUARD_DEFAULTS[k];
    else if (!pred(g[k])) return { ok: false, raw: describe(g), reason: `guard.${k}=${describe(g[k])} が${expect}でない` };
    else out[k] = g[k];
  }
  if (out.intervalMax < out.intervalMin) return { ok: false, raw: describe(g), reason: `guard.intervalMax（${out.intervalMax}）が intervalMin（${out.intervalMin}）より小さい` };
  return { ok: true, guard: out };
}
