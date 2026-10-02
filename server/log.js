// Fran の集約先: logs/YYYY-MM-DD.log（C-2・J-1）
// 当たらなかった入力は code 'INVALID' で、kind（種別）・stage（段＝箇所 ID と関数名）・raw（元の字句）・reason（理由）を残す
import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LOG_DIR = join(__dirname, '..', 'logs');
const RAW_LIMIT = 1000;

export function logFileFor(date = new Date()) {
  return join(LOG_DIR, `${date.toISOString().slice(0, 10)}.log`);
}

function append(entry) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(logFileFor(new Date(entry.ts)), JSON.stringify(entry) + '\n');
  } catch (e) {
    // 集約先に書けないことは標準エラーに出す（ここで黙らない）
    console.error('[log] logs/ への書き込み失敗:', e.message, JSON.stringify(entry).slice(0, 500));
  }
}

export function writeLog(level, code, message, detail) {
  append({ ts: new Date().toISOString(), level, code, message, detail });
}

// 元の字句を文字列にし、長すぎるものは切る（切ったことは残す）
export function toRaw(value) {
  let s;
  if (typeof value === 'string') s = value === '' ? '""' : value;
  else if (value === undefined) s = 'undefined';
  else if (Buffer.isBuffer(value)) s = `<Buffer ${value.length}B> ${value.subarray(0, 64).toString('hex')}`;
  else {
    try { s = JSON.stringify(value); } catch { s = String(value); }
    if (s === undefined) s = String(value);
  }
  return s.length > RAW_LIMIT ? `${s.slice(0, RAW_LIMIT)}…(+${s.length - RAW_LIMIT}字)` : s;
}

// 秘密（トークン・鍵・Authorization の値）は raw に残さず、種別と長さだけを残す（J-3）
export function describeSecret(value) {
  const len = value == null ? 0 : String(value).length;
  return `[secret type=${value === null ? 'null' : typeof value} length=${len}]`;
}

export function recordInvalid({ kind, stage, raw, reason }) {
  const entry = {
    ts: new Date().toISOString(),
    level: 'warn',
    code: 'INVALID',
    message: `${kind}: ${reason}`,
    kind: String(kind),
    stage: String(stage),
    raw: toRaw(raw),
    reason: String(reason),
  };
  append(entry);
  return entry;
}
