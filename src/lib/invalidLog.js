// フロントの集約先（C-2・J-1）: 当たらなかった入力をこの端末のブラウザ内に一つだけ残す
// - 保存方式: localStorage 'pv-invalid-log'（再読み込みで消えない）。使えないときはメモリに退避し、その旨も残す
// - 上限: INVALID_LOG_LIMIT 件。超えたら古いものから落とす
// - 同じ kind・stage・raw は件数（count）を数えて一つにまとめ、最新の位置へ移す（上限で本当の残余が押し流されないため）
// - 秘密（トークン・vault 鍵・Authorization の値）は raw に入れない。describeSecret() で種別と長さだけにする（J-3）

const LS_KEY = 'pv-invalid-log';
export const INVALID_LOG_LIMIT = 200;
const RAW_LIMIT = 500;

let memoryFallback = null;
const listeners = new Set();

export function toRaw(value) {
  let s;
  if (typeof value === 'string') s = value === '' ? '""' : value;
  else if (value === undefined) s = 'undefined';
  else if (value instanceof Error) s = `${value.name}: ${value.message}`;
  else {
    try { s = JSON.stringify(value); } catch { s = String(value); }
    if (s === undefined) s = String(value);
  }
  return s.length > RAW_LIMIT ? `${s.slice(0, RAW_LIMIT)}…(+${s.length - RAW_LIMIT}字)` : s;
}

export function describeSecret(value) {
  const len = value == null ? 0 : String(value).length;
  return `[secret type=${value === null ? 'null' : typeof value} length=${len}]`;
}

function storeEntry(kind, stage, raw, reason) {
  const ts = new Date().toISOString();
  return { ts, lastTs: ts, kind, stage, raw: toRaw(raw), reason, count: 1 };
}

function load() {
  let text;
  try {
    text = localStorage.getItem(LS_KEY);
  } catch (e) {
    const list = memoryFallback ?? [];
    if (!list.some(x => x.kind === 'invalid-log-storage-unavailable')) {
      list.push(storeEntry('invalid-log-storage-unavailable', 'invalidLog.load', e?.message ?? String(e), 'localStorage が読めないためメモリに退避（再読み込みで消える）'));
    }
    memoryFallback = list;
    return list.slice();
  }
  if (text == null) return (memoryFallback ?? []).slice();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    throw new Error('配列でない');
  } catch (e) {
    // 集約先そのものが壊れている: 空にせず、壊れた中身を残す
    return [storeEntry('invalid-log-unparseable', 'invalidLog.load', text, `集約先の保存値を解析できない: ${e.message}`)];
  }
}

function save(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    memoryFallback = null;
  } catch (e) {
    if (!list.some(x => x.kind === 'invalid-log-storage-unavailable')) {
      list.push(storeEntry('invalid-log-storage-unavailable', 'invalidLog.save', e?.message ?? String(e), 'localStorage に書けないためメモリに退避（再読み込みで消える）'));
      while (list.length > INVALID_LOG_LIMIT) list.shift();
    }
    memoryFallback = list;
  }
}

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error('[invalidLog] listener failed', e); }
  }
}

export function recordInvalid({ kind, stage, raw, reason }) {
  const entry = storeEntry(String(kind), String(stage), raw, String(reason));
  const list = load();
  const idx = list.findIndex(x => x.kind === entry.kind && x.stage === entry.stage && x.raw === entry.raw);
  if (idx >= 0) {
    const prev = list.splice(idx, 1)[0];
    entry.ts = prev.ts ?? entry.ts;
    entry.count = (Number.isInteger(prev.count) ? prev.count : 1) + 1;
  }
  list.push(entry);
  while (list.length > INVALID_LOG_LIMIT) list.shift();
  save(list);
  console.warn('[INVALID]', entry.kind, entry.stage, entry.reason, entry.raw);
  notify();
  return entry;
}

export function getInvalidLog() {
  return load();
}

export function clearInvalidLog() {
  memoryFallback = null;
  try { localStorage.removeItem(LS_KEY); } catch {}
  notify();
}

export function subscribeInvalidLog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
