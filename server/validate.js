// 書き込み経路の本文の検査（pv#100・J-6）
// 当たる枝: 下に定めたキーと型だけ。未知のキー・欠けた必須キー・型違い・範囲外・存在しない参照は残余として返す
// （呼び出し側は書き込まずに 400 を返し、INVALID に残す）

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string';
const isNonEmptyStr = v => typeof v === 'string' && v.trim() !== '';
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isBool = v => typeof v === 'boolean';
const isStrArray = v => Array.isArray(v) && v.every(isStr);
const isStrOrNullMap = v => isObj(v) && Object.values(v).every(x => x === null || isStr(x));

function describe(v) {
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v); } catch { return String(v); }
}

class Problems {
  constructor() { this.list = []; }
  add(path, value, reason) { this.list.push({ path, raw: describe(value).slice(0, 200), reason }); }
  // fields: { key: [predicate, '説明'] }。required は必須キー
  object(path, obj, fields, required = []) {
    if (!isObj(obj)) { this.add(path, obj, 'オブジェクトでない'); return false; }
    for (const k of Object.keys(obj)) {
      if (!(k in fields)) this.add(`${path}.${k}`, obj[k], '未知のキー');
    }
    for (const k of required) {
      if (!(k in obj)) this.add(`${path}.${k}`, undefined, '必須のキーがない');
    }
    for (const [k, [pred, expect]] of Object.entries(fields)) {
      if (k in obj && !pred(obj[k])) this.add(`${path}.${k}`, obj[k], `${expect}でない`);
    }
    return true;
  }
  get ok() { return this.list.length === 0; }
}

// ── settings ──
const GENERATION_FIELDS = {
  model: [isNonEmptyStr, '空でない文字列'],
  width: [v => isInt(v, 64, 16384), '64〜16384 の整数'],
  height: [v => isInt(v, 64, 16384), '64〜16384 の整数'],
  steps: [v => isInt(v, 1, 50), '1〜50 の整数'],
  sampler: [isNonEmptyStr, '空でない文字列'],
  scale: [v => isNum(v, 0, 10), '0〜10 の数'],
  seed: [v => isInt(v, -1, 4294967295), '-1〜4294967295 の整数'],
  maxResults: [v => isInt(v, 1, 100), '1〜100 の整数'],
};
const GUARD_FIELDS = {
  intervalMin: [v => isNum(v, 1, 3600), '1〜3600 の数'],
  intervalMax: [v => isNum(v, 1, 3600), '1〜3600 の数'],
  maxPerJob: [v => isInt(v, 1, 500), '1〜500 の整数'],
};
const CAPTION_FIELDS = {
  mode: [isNonEmptyStr, '空でない文字列'],
  fontSize: [isNonEmptyStr, '空でない文字列'],
  color: [isStr, '文字列'],
  outline: [isBool, '真偽値'],
};
const SETTINGS_FIELDS = {
  generation: [isObj, 'オブジェクト'],
  guard: [isObj, 'オブジェクト'],
  captionStyle: [isObj, 'オブジェクト'],
  'sync.recent_days': [v => isInt(v, 1, 3650), '1〜3650 の整数'],
  'sync.r2_limit_gb': [v => isNum(v, 0.001, 1e6), '正の数'],
};

export function validateSettings(body) {
  const p = new Problems();
  if (p.object('settings', body, SETTINGS_FIELDS, ['generation', 'guard', 'captionStyle'])) {
    if (isObj(body.generation)) p.object('settings.generation', body.generation, GENERATION_FIELDS, ['model', 'width', 'height', 'steps', 'sampler', 'scale', 'seed']);
    if (isObj(body.guard)) {
      p.object('settings.guard', body.guard, GUARD_FIELDS, ['intervalMin', 'intervalMax', 'maxPerJob']);
      const { intervalMin, intervalMax } = body.guard;
      if (typeof intervalMin === 'number' && typeof intervalMax === 'number' && intervalMax < intervalMin) {
        p.add('settings.guard.intervalMax', intervalMax, `intervalMin（${intervalMin}）より小さい`);
      }
    }
    if (isObj(body.captionStyle)) p.object('settings.captionStyle', body.captionStyle, CAPTION_FIELDS, ['mode', 'fontSize', 'color', 'outline']);
  }
  return p.list;
}

// ── cards ──
const SLOT_FIELDS = {
  id: [isNonEmptyStr, '空でない文字列'],
  name: [isNonEmptyStr, '空でない文字列'],
  order: [v => isNum(v, -1e9, 1e9), '数'],
  useAsFolder: [isBool, '真偽値'],
  useInFilename: [isBool, '真偽値'],
  updated_at: [isStr, '文字列'],
};
const CARD_FIELDS = {
  id: [isNonEmptyStr, '空でない文字列'],
  slotId: [isNonEmptyStr, '空でない文字列'],
  name: [isNonEmptyStr, '空でない文字列'],
  positive: [isStr, '文字列'],
  negative: [isStr, '文字列'],
  parentId: [v => v === null || isNonEmptyStr(v), 'null か空でない文字列'],
  updated_at: [isStr, '文字列'],
};

export function validateCardsDoc(body) {
  const p = new Problems();
  if (!p.object('cards', body, {
    version: [v => isInt(v, 1, 1e6), '正の整数'],
    slots: [Array.isArray, '配列'],
    cards: [Array.isArray, '配列'],
  }, ['slots', 'cards'])) return p.list;
  if (!Array.isArray(body.slots) || !Array.isArray(body.cards)) return p.list;
  const slotIds = new Set();
  body.slots.forEach((s, i) => {
    p.object(`cards.slots[${i}]`, s, SLOT_FIELDS, ['id', 'name']);
    if (isObj(s) && isNonEmptyStr(s.id)) {
      if (slotIds.has(s.id)) p.add(`cards.slots[${i}].id`, s.id, 'スロット id が重複');
      slotIds.add(s.id);
    }
  });
  const cardIds = new Set();
  body.cards.forEach((c, i) => {
    p.object(`cards.cards[${i}]`, c, CARD_FIELDS, ['id', 'slotId', 'name']);
    if (isObj(c) && isNonEmptyStr(c.id)) {
      if (cardIds.has(c.id)) p.add(`cards.cards[${i}].id`, c.id, 'カード id が重複');
      cardIds.add(c.id);
    }
  });
  body.cards.forEach((c, i) => {
    if (!isObj(c)) return;
    if (isNonEmptyStr(c.slotId) && !slotIds.has(c.slotId)) p.add(`cards.cards[${i}].slotId`, c.slotId, '存在しないスロット');
    if (isNonEmptyStr(c.parentId) && !cardIds.has(c.parentId)) p.add(`cards.cards[${i}].parentId`, c.parentId, '存在しない親カード');
  });
  return p.list;
}

// ── presets ──
const PRESET_BODY_FIELDS = {
  name: [isNonEmptyStr, '空でない文字列'],
  tags: [isStrArray, '文字列の配列'],
  cards: [isStrOrNullMap, '値が文字列か null のオブジェクト'],
  slotOrder: [isStrArray, '文字列の配列'],
  folder: [v => v === null || isStr(v), 'null か文字列'],
  filename: [isStrArray, '文字列の配列'],
  childCards: [isStrOrNullMap, '値が文字列か null のオブジェクト'],
};
const PRESET_FIELDS = { id: [isNonEmptyStr, '空でない文字列'], ...PRESET_BODY_FIELDS, updated_at: [isStr, '文字列'] };

export function validatePresetsDoc(body) {
  const p = new Problems();
  if (!p.object('presets', body, {
    version: [v => isInt(v, 1, 1e6), '正の整数'],
    presets: [Array.isArray, '配列'],
  }, ['presets'])) return p.list;
  if (!Array.isArray(body.presets)) return p.list;
  const ids = new Set();
  body.presets.forEach((x, i) => {
    p.object(`presets.presets[${i}]`, x, PRESET_FIELDS, ['id', 'name']);
    if (isObj(x) && isNonEmptyStr(x.id)) {
      if (ids.has(x.id)) p.add(`presets.presets[${i}].id`, x.id, 'プリセット id が重複');
      ids.add(x.id);
    }
  });
  return p.list;
}

// ── 個別の経路（S-11） ──
export function validateSlotBody(body, { create }) {
  const p = new Problems();
  p.object('slot', body, create ? { name: SLOT_FIELDS.name } : {
    name: SLOT_FIELDS.name, order: SLOT_FIELDS.order, useAsFolder: SLOT_FIELDS.useAsFolder, useInFilename: SLOT_FIELDS.useInFilename,
  });
  return p.list;
}

export function validateCardBody(body, slotIds) {
  const p = new Problems();
  p.object('card', body, {
    slotId: CARD_FIELDS.slotId, name: CARD_FIELDS.name, positive: CARD_FIELDS.positive,
    negative: CARD_FIELDS.negative, parentId: CARD_FIELDS.parentId,
  });
  if (isObj(body) && isNonEmptyStr(body.slotId) && !slotIds.has(body.slotId)) p.add('card.slotId', body.slotId, '存在しないスロット');
  return p.list;
}

export function validatePresetBody(body) {
  const p = new Problems();
  p.object('preset', body, PRESET_BODY_FIELDS);
  return p.list;
}

// ── クエリの数値（S-12） ──
// 未指定（undefined・空文字）は既定値。指定されたら min〜max の整数だけを当たる枝とする
export function parseIntQuery(value, { name, min, max, fallback }) {
  if (value === undefined || value === '') return { ok: true, value: fallback };
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return { ok: false, problem: { path: name, raw: describe(value), reason: '整数でない' } };
  const n = Number(value);
  if (n < min || n > max) return { ok: false, problem: { path: name, raw: describe(value), reason: `範囲外（${min}〜${max}）` } };
  return { ok: true, value: n };
}
