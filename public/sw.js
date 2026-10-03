const CACHE_NAME = 'prompt-vault-v4.1.0';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // クロスオリジンリクエスト（フランサーバー等）は傍受しない
  if (url.origin !== self.location.origin) return;

  // F-16: /api は別オリジン（Fran・Cloud）なので上で素通りし、通常ここには来ない（同一オリジンの /api があった場合の枝）
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request)
      )
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    );
    return;
  }
  // F-16: CLEAR_CACHE 以外のメッセージは黙って捨てず、送り手に返して集約先に残してもらう
  let raw;
  try { raw = JSON.stringify(event.data); } catch (e) { raw = String(event.data); }
  console.warn('[sw] 未知のメッセージ', raw);
  if (event.source && typeof event.source.postMessage === 'function') {
    event.source.postMessage({ type: 'SW_INVALID', kind: 'sw-message-unknown', stage: 'F-16 sw.message', raw, reason: 'CLEAR_CACHE 以外のメッセージ' });
  }
});
