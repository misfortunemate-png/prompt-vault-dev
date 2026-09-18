const LS_KEY = 'pv-connection';
const LS_TIMEOUT_KEY = 'pv-connection-timeout';

export const FRAN_URL = 'https://fraine.tail204746.ts.net:8445/api';
export const CLOUD_URL = 'https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault';

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
  return {
    ...DEFAULTS,
    ...state,
    franUrl: FRAN_URL,
    cloudUrl: CLOUD_URL,
    revision: typeof state.revision === 'string' && state.revision ? state.revision : DEFAULTS.revision,
  };
}

function sameBackendIdentity(a, b) {
  return a.route === b.route && a.token === b.token;
}

// Backend endpoint identity is product-owned. Historical/user-stored endpoint
// values are normalized so connection semantics cannot drift with localStorage.
export function getConnection() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const raw = JSON.parse(saved);
      const parsed = normalizeState(raw);
      if (
        raw.franUrl !== FRAN_URL ||
        raw.cloudUrl !== CLOUD_URL ||
        raw.revision !== parsed.revision
      ) {
        localStorage.setItem(LS_KEY, JSON.stringify(parsed));
      }
      return parsed;
    }
  } catch {}
  return { ...DEFAULTS };
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
  } catch {}
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

function getTimeoutMs() {
  try {
    const v = localStorage.getItem(LS_TIMEOUT_KEY);
    return v ? Number(v) : 8000;
  } catch { return 8000; }
}

async function fetchReachable(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Returns HTTP status (number) or null on network error / timeout / CORS failure.
async function fetchStatus(url, timeoutMs, token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  const franOk = await fetchReachable(FRAN_URL + '/healthz', timeoutMs);
  if (!stillCurrent()) return getConnection();
  if (franOk) {
    return saveConnection({ ...state, route: 'fran', lastCheck, cloudOfflineReason: null });
  }

  const cloudHealthOk = await fetchReachable(CLOUD_URL + '/healthz', timeoutMs);
  if (!stillCurrent()) return getConnection();
  if (cloudHealthOk) {
    if (!state.token) {
      return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason: 'no-token' });
    }
    const settingsStatus = await fetchStatus(CLOUD_URL + '/settings', timeoutMs, state.token);
    if (!stillCurrent()) return getConnection();
    if (settingsStatus !== null && settingsStatus >= 200 && settingsStatus < 300) {
      return saveConnection({ ...state, route: 'cloud', lastCheck, cloudOfflineReason: null });
    }
    const cloudOfflineReason = (settingsStatus === 401 || settingsStatus === 403)
      ? 'auth-failed'
      : 'cloud-error';
    return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason });
  }

  if (!stillCurrent()) return getConnection();
  return saveConnection({ ...state, route: 'offline', lastCheck, cloudOfflineReason: null });
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
    try { localStorage.setItem(LS_TIMEOUT_KEY, String(settings.timeoutMs)); } catch {}
  }
  return saved;
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
