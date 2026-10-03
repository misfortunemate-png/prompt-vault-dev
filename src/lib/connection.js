const LS_KEY = 'pv-connection';
const LS_TIMEOUT_KEY = 'pv-connection-timeout';

export const FRAN_URL = 'https://fraine.tail204746.ts.net:8445/api';
export const CLOUD_URL = 'https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault';

// 当たる枝（F-01・F-02・J-11）。route の残余は normalizeState の一か所で offline とし、元の値を残す
const ROUTES = ['fran', 'cloud', 'offline'];
const OFFLINE_REASONS = [null, 'no-token', 'auth-failed', 'cloud-error'];
const TIMEOUT_DEFAULT = 8000;
const TIMEOUT_MIN = 500;
const TIMEOUT_MAX = 30000;

// 集約先（invalidLog.js）への記録。既存 verifier が connection.js を単独で写して読み込むため静的 import にしない
function recordInvalidLater(entry) {
  import('./invalidLog.js')
    .then(m => m.recordInvalid(entry))
    .catch(e => console.warn('[INVALID] 集約先に記録できない', entry, e));
}

// 読むたびに数えないよう、同じ残余はこのモジュールの中で一度だけ記録する
const reportedOnce = new Set();
function reportOnce(key, entry) {
  if (reportedOnce.has(key)) return;
  reportedOnce.add(key);
  recordInvalidLater(entry);
}

// J-3: トークンの値は残さず、種別と長さだけ
function describeSecret(value) {
  const len = value == null ? 0 : String(value).length;
  return `[secret type=${value === null ? 'null' : typeof value} length=${len}]`;
}

const DEFAULTS = {
  route: 'offline',
  manual: false,
  lastCheck: null,
  franUrl: FRAN_URL,
  cloudUrl: CLOUD_URL,
  token: '',
  revision: '0',
  cloudOfflineReason: null, // null | 'no-token' | 'auth-failed' | 'cloud-error'
};

function newRevision() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeState(state = {}) {
  const out = {
    ...DEFAULTS,
    ...state,
    franUrl: FRAN_URL,
    cloudUrl: CLOUD_URL,
    revision: typeof state.revision === 'string' && state.revision ? state.revision : DEFAULTS.revision,
  };
  if (!ROUTES.includes(out.route)) {
    reportOnce(`route|${String(out.route)}`, { kind: 'connection-route-unknown', stage: 'F-02 connection.normalizeState', raw: { route: out.route }, reason: 'route が fran/cloud/offline のどれでもない（offline として扱う）' });
    out.route = 'offline';
  }
  if (!OFFLINE_REASONS.includes(out.cloudOfflineReason)) {
    reportOnce(`reason|${String(out.cloudOfflineReason)}`, { kind: 'connection-offline-reason-unknown', stage: 'F-01 connection.normalizeState', raw: { cloudOfflineReason: out.cloudOfflineReason }, reason: 'cloudOfflineReason が null/no-token/auth-failed/cloud-error のどれでもない（理由なしとして扱う）' });
    out.cloudOfflineReason = null;
  }
  if (typeof out.token !== 'string') {
    reportOnce(`token|${typeof out.token}`, { kind: 'connection-token-not-string', stage: 'F-01 connection.normalizeState', raw: describeSecret(out.token), reason: 'token が文字列でない（未設定として扱う）' });
    out.token = '';
  }
  if (typeof out.manual !== 'boolean') {
    reportOnce(`manual|${String(out.manual)}`, { kind: 'connection-manual-not-boolean', stage: 'F-01 connection.normalizeState', raw: { manual: out.manual }, reason: 'manual が真偽値でない（手動固定なしとして扱う）' });
    out.manual = false;
  }
  if (out.lastCheck !== null && typeof out.lastCheck !== 'string') {
    reportOnce(`lastCheck|${String(out.lastCheck)}`, { kind: 'connection-lastcheck-invalid', stage: 'F-01 connection.normalizeState', raw: { lastCheck: out.lastCheck }, reason: 'lastCheck が文字列でも null でもない' });
    out.lastCheck = null;
  }
  for (const k of Object.keys(out)) {
    if (!(k in DEFAULTS)) {
      reportOnce(`key|${k}`, { kind: 'connection-unknown-key', stage: 'F-01 connection.normalizeState', raw: { key: k }, reason: '接続設定に未知のキー（読み飛ばす）' });
      delete out[k];
    }
  }
  return out;
}

function sameBackendIdentity(a, b) {
  return a.route === b.route && a.token === b.token;
}

// Backend endpoint identity is product-owned. Historical/user-stored endpoint
// values are normalized so connection semantics cannot drift with localStorage.
export function getConnection() {
  let saved;
  try {
    saved = localStorage.getItem(LS_KEY);
  } catch (e) {
    reportOnce('storage-read', { kind: 'connection-storage-unavailable', stage: 'F-01 connection.getConnection', raw: e?.message ?? String(e), reason: 'localStorage が読めない（未接続として扱う）' });
    return { ...DEFAULTS };
  }
  if (!saved) return { ...DEFAULTS };
  let raw;
  try {
    raw = JSON.parse(saved);
  } catch (e) {
    // 壊れた値は消さずに残し、記録する（トークンを含みうるので種別と長さだけ）
    reportOnce(`unparseable|${saved.length}`, { kind: 'connection-state-unparseable', stage: 'F-01 connection.getConnection', raw: describeSecret(saved), reason: `pv-connection を JSON として解析できない（未接続として扱う）: ${e.message}` });
    return { ...DEFAULTS };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    reportOnce(`not-object|${saved.length}`, { kind: 'connection-state-unparseable', stage: 'F-01 connection.getConnection', raw: describeSecret(saved), reason: 'pv-connection がオブジェクトでない（未接続として扱う）' });
    return { ...DEFAULTS };
  }
  const parsed = normalizeState(raw);
  const changed = Object.keys(parsed).some(k => raw[k] !== parsed[k]) || Object.keys(raw).some(k => !(k in parsed));
  if (changed) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(parsed));
    } catch (e) {
      reportOnce('storage-write', { kind: 'connection-storage-unavailable', stage: 'F-01 connection.getConnection', raw: e?.message ?? String(e), reason: 'localStorage に書けない' });
    }
  }
  return parsed;
}

// revision is an opaque backend-identity generation. It changes only when
// route or authentication principal changes; lastCheck/manual/diagnostic
// updates do not invalidate backend-scoped data.
export function saveConnection(state) {
  const previous = getConnection();
  const normalized = normalizeState(state);
  normalized.revision = sameBackendIdentity(previous, normalized)
    ? previous.revision
    : newRevision();
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(normalized));
  } catch (e) {
    reportOnce('storage-write', { kind: 'connection-storage-unavailable', stage: 'F-01 connection.saveConnection', raw: e?.message ?? String(e), reason: 'localStorage に書けない' });
  }
  return normalized;
}

export function captureConnectionSnapshot(state = getConnection()) {
  return Object.freeze({
    revision: state.revision,
    route: state.route,
    token: state.token,
  });
}

export function isConnectionSnapshotCurrent(snapshot) {
  if (!snapshot) return false;
  const current = getConnection();
  return current.revision === snapshot.revision
    && current.route === snapshot.route
    && current.token === snapshot.token;
}

// F-03: 当たる枝は 500〜30000 の整数。未設定は既定値。当たらない保存値は既定値で確かめ、元の値を記録する
function parseTimeout(value) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN);
  return Number.isInteger(n) && n >= TIMEOUT_MIN && n <= TIMEOUT_MAX ? n : null;
}

function getTimeoutMs() {
  let v;
  try {
    v = localStorage.getItem(LS_TIMEOUT_KEY);
  } catch (e) {
    reportOnce('timeout-storage', { kind: 'connection-storage-unavailable', stage: 'F-03 connection.getTimeoutMs', raw: e?.message ?? String(e), reason: `localStorage が読めない（既定の ${TIMEOUT_DEFAULT}ms）` });
    return TIMEOUT_DEFAULT;
  }
  if (v === null || v === '') return TIMEOUT_DEFAULT;
  const n = parseTimeout(v);
  if (n === null) {
    reportOnce(`timeout|${v}`, { kind: 'reachability-timeout-invalid', stage: 'F-03 connection.getTimeoutMs', raw: v, reason: `${TIMEOUT_MIN}〜${TIMEOUT_MAX} の整数でない（既定の ${TIMEOUT_DEFAULT}ms で確かめる）` });
    return TIMEOUT_DEFAULT;
  }
  return n;
}

// F-04・J-12: 到達確認の結果を理由付きで返す（通信失敗・タイムアウト・2xx 以外の status）
async function fetchReachable(url, timeoutMs, token) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    const init = { signal: ctrl.signal };
    if (token) init.headers = { 'Authorization': `Bearer ${token}` };
    const res = await fetch(url, init);
    return { ok: !!res.ok, status: res.status ?? null, reason: res.ok ? null : 'status' };
  } catch (e) {
    return { ok: false, status: null, reason: timedOut ? 'timeout' : 'network', error: e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function probeReasonText(p, timeoutMs) {
  if (p.reason === 'timeout') return `タイムアウト（${timeoutMs}ms）`;
  if (p.reason === 'network') return '通信失敗（network・CORS を含む）';
  return `2xx 以外（status ${p.status}）`;
}

// Generation counter: incremented on each new probe start and on manual switch.
// Any in-flight probe whose gen no longer matches _probeGeneration is stale and must not commit.
let _probeGeneration = 0;

export async function checkReachability() {
  const state = getConnection();
  if (state.manual) return state;
  const snapshot = captureConnectionSnapshot(state);
  const gen = ++_probeGeneration;
  const timeoutMs = getTimeoutMs();
  const lastCheck = new Date().toISOString();

  const stillCurrent = () => {
    const current = getConnection();
    return gen === _probeGeneration
      && isConnectionSnapshotCurrent(snapshot)
      && current.manual === state.manual;
  };

  const fran = await fetchReachable(FRAN_URL + '/healthz', timeoutMs);
  if (!stillCurrent()) return getConnection();
  if (fran.ok) {
    return saveConnection({ ...state, route: 'fran', lastCheck, cloudOfflineReason: null });
  }
  recordInvalidLater({ kind: 'reachability-fran-failed', stage: 'F-04 connection.checkReachability', raw: { url: FRAN_URL + '/healthz', reason: fran.reason, status: fran.status, error: fran.error ?? null }, reason: `Fran に到達できない: ${probeReasonText(fran, timeoutMs)}` });

  // family-auth: クラウドの healthz は入口照合の内側。トークンが無ければ叩かない
  if (!state.token) {
    return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason: 'no-token' });
  }
  // pv#53 の verifier がこの行を負の対照の目印にしている（変えない）。戻り値は到達確認の結果（ok・status・reason）
  const cloudHealthOk = await fetchReachable(CLOUD_URL + '/healthz', timeoutMs, state.token);
  const health = cloudHealthOk;
  if (!stillCurrent()) return getConnection();
  if (health.ok) {
    const settings = await fetchReachable(CLOUD_URL + '/settings', timeoutMs, state.token);
    if (!stillCurrent()) return getConnection();
    if (settings.ok) {
      return saveConnection({ ...state, route: 'cloud', lastCheck, cloudOfflineReason: null });
    }
    if (settings.status === 401 || settings.status === 403) {
      return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason: 'auth-failed' });
    }
    recordInvalidLater({ kind: 'reachability-cloud-failed', stage: 'F-04 connection.checkReachability', raw: { url: CLOUD_URL + '/settings', reason: settings.reason, status: settings.status, error: settings.error ?? null }, reason: `Cloud /settings: ${probeReasonText(settings, timeoutMs)}（cloud-error）` });
    return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason: 'cloud-error' });
  }
  // J-12: healthz は入口照合の内側。401・403 はトークン不正として通信失敗と分ける
  if (health.status === 401 || health.status === 403) {
    return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason: 'auth-failed' });
  }
  recordInvalidLater({ kind: 'reachability-cloud-failed', stage: 'F-04 connection.checkReachability', raw: { url: CLOUD_URL + '/healthz', reason: health.reason, status: health.status, error: health.error ?? null }, reason: `Cloud /healthz: ${probeReasonText(health, timeoutMs)}` });
  if (!stillCurrent()) return getConnection();
  return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason: health.reason === 'status' ? 'cloud-error' : null });
}

export function switchRoute(target) {
  ++_probeGeneration;
  const state = getConnection();
  return saveConnection({ ...state, route: target, manual: true });
}

export async function clearManual() {
  const state = getConnection();
  saveConnection({ ...state, manual: false });
  return checkReachability();
}

export function updateSettings(settings) {
  const state = getConnection();
  const next = { ...state };
  if (settings.token !== undefined) next.token = settings.token;
  const saved = saveConnection(next);
  if (settings.timeoutMs !== undefined) {
    const n = parseTimeout(settings.timeoutMs);
    if (n === null) {
      // F-03: 当たらない値は保存しない（以前の値を保つ）
      recordInvalidLater({ kind: 'reachability-timeout-invalid', stage: 'F-03 connection.updateSettings', raw: settings.timeoutMs, reason: `${TIMEOUT_MIN}〜${TIMEOUT_MAX} の整数でないため保存しない` });
    } else {
      try {
        localStorage.setItem(LS_TIMEOUT_KEY, String(n));
      } catch (e) {
        recordInvalidLater({ kind: 'connection-storage-unavailable', stage: 'F-03 connection.updateSettings', raw: e?.message ?? String(e), reason: 'localStorage に書けない' });
      }
    }
  }
  return saved;
}

export function isValidTimeout(value) {
  return parseTimeout(value) !== null;
}

export function getTimeoutSetting() {
  return getTimeoutMs();
}

// visibilitychange: manual=false の場合のみ再確認。コールバックで呼び出し元に通知。
let _onRecheck = null;

export function initVisibilityCheck(onRecheck) {
  _onRecheck = onRecheck;
  document.addEventListener('visibilitychange', _handleVisibility);
}

export function destroyVisibilityCheck() {
  document.removeEventListener('visibilitychange', _handleVisibility);
  _onRecheck = null;
}

function _handleVisibility() {
  if (document.visibilityState !== 'visible') return;
  const state = getConnection();
  if (!state.manual && _onRecheck) _onRecheck();
}

export function resolveApiUrl(path) {
  const conn = getConnection();
  if (conn.route === 'cloud') return CLOUD_URL + path;
  return FRAN_URL + path;
}

export function resolveThumbUrl(hash) {
  const conn = getConnection();
  if (conn.route === 'cloud') return CLOUD_URL + `/thumbs/${hash}`;
  return FRAN_URL + `/thumbs/${hash}.webp`;
}

export function resolveFullImgUrl(hash) {
  return FRAN_URL + `/images/full/${hash}`;
}

export function resolveTmpImgUrl(filename) {
  return FRAN_URL + `/images/.tmp/${filename}`;
}
