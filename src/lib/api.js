import { getConnection } from './connection.js';

async function request(path, opts = {}) {
  const conn = getConnection();
  let base;
  if (conn.route === 'fran') {
    base = conn.franUrl;
  } else if (conn.route === 'cloud') {
    base = conn.cloudUrl;
  } else {
    throw new Error('オフライン: サーバーに接続できません');
  }

  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (conn.route === 'cloud' && conn.token) {
    headers['Authorization'] = `Bearer ${conn.token}`;
  }

  let res;
  try {
    res = await fetch(`${base}${path}`, { ...opts, headers });
  } catch (e) {
    const route = conn.route === 'cloud' ? 'Cloud' : 'Fran';
    throw new Error(`ネットワークエラー [${route}] ${path}: ${e.message || '到達不能'}`);
  }

  if (!res.ok) {
    let body = '';
    try { const j = await res.json(); body = j.error || j.message || ''; } catch {}
    const detail = body ? `: ${body}` : '';
    if (res.status === 401) throw new Error(`認証エラー (401): トークンを設定してください`);
    if (res.status === 403) throw new Error(`権限エラー (403)${detail}`);
    if (res.status === 404) throw new Error(`エンドポイント未実装 (404): ${path}`);
    if (res.status >= 500) throw new Error(`サーバーエラー (${res.status})${detail}`);
    throw new Error(`API エラー (${res.status})${detail}`);
  }
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

  // Cards / Slots
  getCards: () => request('/cards'),
  putCards: (data) => request('/cards', { method: 'PUT', body: JSON.stringify(data) }),
  addSlot: (data) => request('/cards/slot', { method: 'POST', body: JSON.stringify(data) }),
  updateSlot: (id, data) => request(`/cards/slot/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSlot: (id) => request(`/cards/slot/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addCard: (data) => request('/cards/card', { method: 'POST', body: JSON.stringify(data) }),
  updateCard: (id, data) => request(`/cards/card/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCard: (id) => request(`/cards/card/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicateCard: (id) => request(`/cards/card/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),

  // Presets
  getPresets: () => request('/presets'),
  getPresetTags: () => request('/presets/tags'),
  addPreset: (data) => request('/presets', { method: 'POST', body: JSON.stringify(data) }),
  updatePreset: (id, data) => request(`/presets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePreset: (id) => request(`/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicatePreset: (id) => request(`/presets/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),

  // Tags
  searchTags: (q) => request(`/tags/search?q=${encodeURIComponent(q)}`),

  // Generate / Save
  generate: (data) => request('/generate', { method: 'POST', body: JSON.stringify(data) }),
  saveImage: (data) => request('/save', { method: 'POST', body: JSON.stringify(data) }),

  // Images (legacy M2)
  getImages: () => request('/images'),
  getImageFolder: (folder) => request(`/images/${encodeURIComponent(folder)}`),

  // Gallery (M4-A)
  getGallery: () => request('/gallery'),
  getGalleryFolder: (path) => request(`/gallery/folder?path=${encodeURIComponent(path)}`),
  getRecentImages: (limit = 20) => request(`/gallery/recent?limit=${limit}`),
  getGalleryImage: (hash) => request(`/gallery/image/${encodeURIComponent(hash)}`),
  getGalleryStats: () => request('/gallery/stats'),

  // Rescan
  postRescan: () => request('/rescan', { method: 'POST' }),
  getRescanStatus: () => request('/rescan/status'),

  // Gallery M4-B
  setFavorite: (hash, favorite) => request(`/gallery/image/${encodeURIComponent(hash)}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite }) }),
  getFavorites: (limit = 50) => request(`/gallery/favorites?limit=${limit}`),
  searchGallery: (q, limit = 50) => request(`/gallery/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  getByPreset: (presetId, limit = 50) => request(`/gallery/by-preset/${encodeURIComponent(presetId)}?limit=${limit}`),
  setCaption: (hash, caption, captionConfig) => request(`/gallery/image/${encodeURIComponent(hash)}/caption`, {
    method: 'PUT',
    body: JSON.stringify(captionConfig !== undefined ? { caption, captionConfig } : { caption }),
  }),
  deleteGalleryImage: (hash) => request(`/gallery/image/${encodeURIComponent(hash)}`, { method: 'DELETE' }),
  getGalleryByCard: (positive, limit = 4) => request(`/gallery/by-card?positive=${encodeURIComponent(positive)}&limit=${limit}`),

  // Queue M5
  getQueue: () => request('/queue'),
  queueAdd: (tasks) => request('/queue/add', { method: 'POST', body: JSON.stringify({ tasks }) }),
  queueRemoveTask: (id) => request(`/queue/task/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  queueClear: () => request('/queue/clear', { method: 'DELETE' }),
  queueStart: () => request('/queue/start', { method: 'POST' }),
  queueStop: () => request('/queue/stop', { method: 'POST' }),
  queueTaskSave: (id) => request(`/queue/task/${encodeURIComponent(id)}/save`, { method: 'POST' }),
};
