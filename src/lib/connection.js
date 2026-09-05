const LS_KEY = 'pv-connection';
const LS_TIMEOUT_KEY = 'pv-connection-timeout';

const DEFAULTS = {
  route: 'offline',
  manual: false,
  lastCheck: null,
  franUrl: 'https://fraine.tail204746.ts.net:8445/api',
  cloudUrl: 'https://ai-family-foundation.shogosakamoto.workers.dev/api/prompt-vault',
  token: '',
};

// 旧デフォルト URL（ポート未指定→443→別サービス）を自動修正
function migrateState(state) {
  if (state.franUrl === 'https://fraine.tail204746.ts.net/api') {
    return { ...state, franUrl: 'https://fraine.tail204746.ts.net:8445/api' };
  }
  return state;
}

export function getConnection() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const raw = JSON.parse(saved);
      const parsed = migrateState(raw);
      if (parsed !== raw) localStorage.setItem(LS_KEY, JSON.stringify(parsed));
      return { ...DEFAULTS, ...parsed };
    }
  } catch {}
  return { ...DEFAULTS };
}

export function saveConnection(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
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

export async function checkReachability() {
  const state = getConnection();
  if (state.manual) return state;
  const timeoutMs = getTimeoutMs();
  const lastCheck = new Date().toISOString();

  const franOk = await fetchReachable(state.franUrl + '/healthz', timeoutMs);
  if (franOk) {
    const next = { ...state, route: 'fran', lastCheck };
    saveConnection(next);
    return next;
  }

  if (state.cloudUrl) {
    const cloudOk = await fetchReachable(state.cloudUrl + '/healthz', timeoutMs);
    if (cloudOk) {
      const next = { ...state, route: 'cloud', lastCheck };
      saveConnection(next);
      return next;
    }
  }

  const next = { ...state, route: 'offline', lastCheck };
  saveConnection(next);
  return next;
}

export function switchRoute(target) {
  const state = getConnection();
  const next = { ...state, route: target, manual: true };
  saveConnection(next);
  return next;
}

export async function clearManual() {
  const state = getConnection();
  saveConnection({ ...state, manual: false });
  return checkReachability();
}

export function updateSettings(settings) {
  const state = getConnection();
  const next = { ...state };
  if (settings.franUrl !== undefined) next.franUrl = settings.franUrl;
  if (settings.cloudUrl !== undefined) next.cloudUrl = settings.cloudUrl;
  if (settings.token !== undefined) next.token = settings.token;
  saveConnection(next);
  if (settings.timeoutMs !== undefined) {
    try { localStorage.setItem(LS_TIMEOUT_KEY, String(settings.timeoutMs)); } catch {}
  }
  return next;
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
  if (conn.route === 'cloud') return conn.cloudUrl + path;
  return conn.franUrl + path;
}

export function resolveThumbUrl(hash) {
  const conn = getConnection();
  if (conn.route === 'cloud') return conn.cloudUrl + `/thumbs/${hash}`;
  return conn.franUrl + `/thumbs/${hash}.webp`;
}

export function resolveFullImgUrl(hash) {
  const conn = getConnection();
  return conn.franUrl + `/images/full/${hash}`;
}

export function resolveTmpImgUrl(filename) {
  const conn = getConnection();
  return conn.franUrl + `/images/.tmp/${filename}`;
}
