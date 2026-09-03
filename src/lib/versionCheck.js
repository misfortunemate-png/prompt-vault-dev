const POLL_INTERVAL = 5 * 60 * 1000;

function getCurrentHash() {
  const el = document.querySelector('script[type=module][src*="/assets/index-"]');
  if (!el) return null;
  const m = el.src.match(/\/assets\/index-([^.]+)\.js/);
  return m?.[1] ?? null;
}

async function fetchLatestHash() {
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'index.html?_v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/\/assets\/index-([^.]+)\.js/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function startVersionCheck(onUpdateAvailable) {
  const initial = getCurrentHash();
  if (!initial) return () => {};

  const id = setInterval(async () => {
    const latest = await fetchLatestHash();
    if (latest && latest !== initial) {
      clearInterval(id);
      onUpdateAvailable();
    }
  }, POLL_INTERVAL);

  return () => clearInterval(id);
}
