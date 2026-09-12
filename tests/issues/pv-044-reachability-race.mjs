function check(name, ok, detail = '') {
  return { name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

async function ticks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

export default {
  issue: 'pv#44',
  title: 'stale reachability checks must not overwrite newer connection intent',
  level: 'AUTO',
  gate: true,
  verifierPath: 'tests/issues/pv-044-reachability-race.mjs',

  async verify() {
    globalThis.localStorage = makeStorage();
    globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
    const mod = await import(`../../src/lib/connection.js?pv44=${Date.now()}`);
    const base = { route: 'offline', manual: false, lastCheck: null, franUrl: 'https://fran.invalid/api', cloudUrl: 'https://cloud.invalid/api', token: 'token' };
    const checks = [];

    // Scenario 1: a manual switch made while a probe is pending must win.
    mod.saveConnection(base);
    const first = deferred();
    globalThis.fetch = () => first.promise;
    const pending = mod.checkReachability();
    await ticks();
    mod.switchRoute('cloud');
    first.resolve({ ok: true });
    await pending;
    const afterManual = mod.getConnection();
    checks.push(check('pending probe cannot overwrite later manual switch', afterManual.manual === true && afterManual.route === 'cloud', `final=${JSON.stringify({ route: afterManual.route, manual: afterManual.manual })}`));

    // Scenario 2: an older probe finishing later must not overwrite a newer probe.
    mod.saveConnection(base);
    const requests = [];
    globalThis.fetch = () => {
      const d = deferred();
      requests.push(d);
      return d.promise;
    };
    const older = mod.checkReachability();
    const newer = mod.checkReachability();
    await ticks();
    if (requests[1]) requests[1].resolve({ ok: true }); // newer => Fran
    await newer;
    if (requests[0]) requests[0].resolve({ ok: false }); // older Fran miss
    await ticks();
    if (requests[2]) requests[2].resolve({ ok: true });  // older Cloud health
    await ticks();
    if (requests[3]) requests[3].resolve({ ok: true });  // older Cloud auth
    await Promise.race([older, new Promise((r) => setTimeout(r, 100))]);
    const afterOrder = mod.getConnection();
    checks.push(check('older out-of-order probe cannot overwrite newer result', afterOrder.route === 'fran', `final route=${afterOrder.route}; requests=${requests.length}`));

    return checks;
  },
};
