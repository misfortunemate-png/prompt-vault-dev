// localStorage の読み書きと、保存された JSON 欄の解析（pv#111・C-1・C-2）
// 当たる枝: キーがない（未保存）／定めた形の値。当たらないもの（解析できない・形が違う・値が当たらない・読み書きできない）は
// 集約先（invalidLog）に残し、呼び出し側は既定に戻す（表示・選択の状態なので、記録したうえで既定を使う）
import { recordInvalid } from './invalidLog.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function describe(v) {
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v); } catch { return String(v); }
}

function readText(key, stage) {
  try {
    return { ok: true, text: localStorage.getItem(key) };
  } catch (e) {
    recordInvalid({ kind: 'local-storage-unavailable', stage, raw: { key, error: e?.message ?? String(e) }, reason: 'localStorage が読めない（既定を使う）' });
    return { ok: false, text: null };
  }
}

function readJson(key, stage) {
  const r = readText(key, stage);
  if (!r.ok || r.text === null || r.text === '') return undefined;
  try {
    return JSON.parse(r.text);
  } catch (e) {
    recordInvalid({ kind: 'local-storage-unparseable', stage, raw: { key, text: r.text }, reason: `JSON として解析できない（既定を使う）: ${e.message}` });
    return undefined;
  }
}

// { 任意のキー: 値 } の形。値が valuePred に当たらない項目は読み飛ばして記録する
export function readStoredMap(key, stage, valuePred, expect) {
  const v = readJson(key, stage);
  if (v === undefined) return null;
  if (!isPlainObject(v)) {
    recordInvalid({ kind: 'local-storage-not-object', stage, raw: { key, value: v }, reason: 'オブジェクトでない（既定を使う）' });
    return null;
  }
  const out = {};
  const bad = [];
  for (const [k, x] of Object.entries(v)) {
    if (valuePred(x)) out[k] = x;
    else bad.push({ key: k, value: x });
  }
  if (bad.length) {
    recordInvalid({ kind: 'local-storage-value-invalid', stage, raw: { key, entries: bad.slice(0, 10) }, reason: `${expect}でない値を読み飛ばす（${bad.length} 件）` });
  }
  return out;
}

// 決まったキーを持つオブジェクト。fields: { 名前: [predicate, '説明'] }。当たる欄だけを返す
export function readStoredObject(key, stage, fields) {
  const v = readJson(key, stage);
  if (v === undefined) return null;
  if (!isPlainObject(v)) {
    recordInvalid({ kind: 'local-storage-not-object', stage, raw: { key, value: v }, reason: 'オブジェクトでない（既定を使う）' });
    return null;
  }
  const out = {};
  const bad = [];
  for (const [k, x] of Object.entries(v)) {
    if (!(k in fields)) { bad.push({ field: k, value: x, reason: '未知のキー' }); continue; }
    const [pred, expect] = fields[k];
    if (pred(x)) out[k] = x;
    else bad.push({ field: k, value: x, reason: `${expect}でない` });
  }
  if (bad.length) {
    recordInvalid({ kind: 'local-storage-value-invalid', stage, raw: { key, fields: bad.slice(0, 10) }, reason: bad.map(b => `${b.field}: ${b.reason}`).join(' / ') + '（既定を使う）' });
  }
  return out;
}

// 整数の値。未保存は fallback。当たらない値は fallback を使い記録する
export function readStoredInt(key, stage, { min, max, fallback }) {
  const r = readText(key, stage);
  if (!r.ok || r.text === null || r.text === '') return fallback;
  const n = /^-?\d+$/.test(r.text.trim()) ? Number(r.text) : NaN;
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  recordInvalid({ kind: 'local-storage-value-invalid', stage, raw: { key, text: r.text }, reason: `${min}〜${max} の整数でない（${fallback} を使う）` });
  return fallback;
}

export function writeStored(key, value, stage) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch (e) {
    recordInvalid({ kind: 'local-storage-write-failed', stage, raw: { key, error: e?.message ?? String(e) }, reason: 'localStorage に書けない（次回は復元されない）' });
    return false;
  }
}

// 応答に入っている JSON の欄（caption_config・char_prompts など）。解析できないものは id ごとに一度だけ記録して null
const reportedFields = new Set();
export function parseJsonOnce(text, { kind, stage, id }) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const k = `${kind}|${id}|${String(text).slice(0, 100)}`;
    if (!reportedFields.has(k)) {
      reportedFields.add(k);
      recordInvalid({ kind, stage, raw: { id, text: describe(text).slice(0, 300) }, reason: `JSON として解析できない: ${e.message}` });
    }
    return null;
  }
}
