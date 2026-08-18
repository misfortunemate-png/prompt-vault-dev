const BASE = '/api';

async function request(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

export const api = {
  healthz: () => request('/healthz'),
  getSettings: () => request('/settings'),
  putSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getSystemInfo: () => request('/system-info'),
  getErrors: () => request('/debug/errors'),
  testApi: () => request('/debug/test-api', { method: 'POST' }),
  testFs: () => request('/debug/test-fs', { method: 'POST' }),
  reset: () => request('/debug/reset', { method: 'POST' }),
};
