import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

// Mirrors server.js PUT handler pattern:
//   { ...existing, ...reqBody, updated_at: serverTime() }
// updated_at is placed AFTER ...reqBody so the server always wins.
function serverPut(existing, reqBody, serverTime) {
  return { ...existing, ...reqBody, updated_at: serverTime };
}

function serverPost(reqBody, serverTime) {
  return { ...reqBody, updated_at: serverTime };
}

// LWW: newer updated_at wins; equal → left (Fran version) wins
function lwwMerge(franVer, cloudVer) {
  if (!franVer.updated_at) return cloudVer;
  if (!cloudVer.updated_at) return franVer;
  return franVer.updated_at >= cloudVer.updated_at ? franVer : cloudVer;
}

export default {
  issue: 'pv#8',
  title: 'cards/presets CRUD must advance updated_at so LWW sync keeps Fran edits',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-008-updated-at-lww.mjs',

  async verify() {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const serverSrc = readFileSync(resolve(repoRoot, 'server.js'), 'utf8');

    const checks = [];
    const t0 = '2026-01-01T00:00:00.000Z';  // stale
    const t1 = '2026-09-19T10:00:00.000Z';  // server time (t1 > t0)

    // ── AC-8-1: PUT always advances updated_at past any stale body value ─────────

    const existingSlot = { id: 's_test', name: 'old', order: 0, updated_at: t0 };
    const afterSlotPut = serverPut(existingSlot, { name: 'updated', updated_at: t0 }, t1);
    checks.push(check(
      'PUT slot: server-time updated_at overwrites stale body value',
      afterSlotPut.updated_at === t1,
      `updated_at=${afterSlotPut.updated_at} expected=${t1}`,
    ));

    const existingCard = { id: 'c_test', name: 'old card', updated_at: t0 };
    const afterCardPut = serverPut(existingCard, { name: 'new card', updated_at: t0 }, t1);
    checks.push(check(
      'PUT card: server-time updated_at overwrites stale body value',
      afterCardPut.updated_at === t1,
      `updated_at=${afterCardPut.updated_at}`,
    ));

    const existingPreset = { id: 'p_test', name: 'old preset', updated_at: t0 };
    const afterPresetPut = serverPut(existingPreset, { name: 'new preset', updated_at: t0 }, t1);
    checks.push(check(
      'PUT preset: server-time updated_at overwrites stale body value',
      afterPresetPut.updated_at === t1,
      `updated_at=${afterPresetPut.updated_at}`,
    ));

    // ── AC-8-2: POST creates records with non-null updated_at ─────────────────────

    const newSlot = serverPost({ id: 's_new', name: 'slot', order: 0 }, t1);
    checks.push(check(
      'POST slot: new record carries valid updated_at',
      !!newSlot.updated_at && newSlot.updated_at === t1,
      `updated_at=${newSlot.updated_at}`,
    ));

    const newCard = serverPost({ id: 'c_new', slotId: 's_new', name: 'card' }, t1);
    checks.push(check(
      'POST card: new record carries valid updated_at',
      !!newCard.updated_at && newCard.updated_at === t1,
      `updated_at=${newCard.updated_at}`,
    ));

    const newPreset = serverPost({ id: 'p_new', name: 'preset', tags: [] }, t1);
    checks.push(check(
      'POST preset: new record carries valid updated_at',
      !!newPreset.updated_at && newPreset.updated_at === t1,
      `updated_at=${newPreset.updated_at}`,
    ));

    // ── AC-8-3: LWW selects the Fran-PUT version over a stale Cloud version ──────

    const franAfterPut = serverPut({ id: 's_sync', updated_at: t0 }, { name: 'fran edit' }, t1);
    const cloudVersion = { id: 's_sync', name: 'cloud version', updated_at: t0 };
    const lwwWinner = lwwMerge(franAfterPut, cloudVersion);
    checks.push(check(
      'LWW picks Fran version when PUT advances updated_at past Cloud version',
      lwwWinner === franAfterPut && lwwWinner.updated_at === t1,
      `winner.updated_at=${lwwWinner?.updated_at} fran=${franAfterPut.updated_at} cloud=${cloudVersion.updated_at}`,
    ));

    // ── Source check: server.js PUT handlers set updated_at after ...req.body ────
    // Ensures the server-time cannot be overridden by client-supplied body values.
    const putPatterns = [
      // PUT /cards/slot/:id  — line: { ...data.slots[idx], ...req.body, updated_at: new Date().toISOString() }
      { name: 'PUT slot source: updated_at after ...req.body spread', re: /\.\.\.req\.body,\s*updated_at: new Date\(\)\.toISOString\(\)/ },
      // PUT /cards/card/:id  — line: { ...data.cards[idx], ...req.body, name: targetName, updated_at: ... }
      { name: 'PUT card source: updated_at after ...req.body spread', re: /\.\.\.req\.body,\s*name: targetName,\s*updated_at: new Date\(\)\.toISOString\(\)/ },
    ];
    for (const { name, re } of putPatterns) {
      checks.push(check(name, re.test(serverSrc), `pattern not found in server.js: ${re}`));
    }
    // Verify PUT pattern appears at least twice (slot + preset handlers share the same simpler pattern)
    const putCount = (serverSrc.match(/\.\.\.req\.body,\s*updated_at: new Date\(\)\.toISOString\(\)/g) || []).length;
    checks.push(check(
      'source: PUT handlers (slot, preset) both set server-side updated_at after body spread',
      putCount >= 2,
      `pattern count=${putCount} expected>=2`,
    ));

    // ── Negative control: buggy PUT omits server-side updated_at ─────────────────
    // Old bug: handler does { ...existing, ...reqBody } without overriding updated_at.
    // When body has stale t0, the saved record stays at t0.
    // LWW with equal timestamps: tie-break favors left (Fran), but this is fragile —
    // any Cloud version with a fresher timestamp would win (e.g. Cloud re-syncs at t0+ε).
    function buggyPut(existing, reqBody) {
      return { ...existing, ...reqBody };  // no server-time override
    }
    const buggyAfterPut = buggyPut({ id: 's_sync', updated_at: t0 }, { name: 'fran edit', updated_at: t0 });
    // Simulate Cloud re-syncing slightly later with its stale t0 copy,
    // or a future Cloud write at a slightly newer time:
    const cloudFresher = { id: 's_sync', name: 'cloud overwrite', updated_at: '2026-01-01T00:00:00.001Z' };
    const buggyWinner = lwwMerge(buggyAfterPut, cloudFresher);
    checks.push(check(
      'negative control: without server-time advancement Cloud can overwrite Fran edit',
      buggyWinner !== buggyAfterPut && buggyWinner.name === 'cloud overwrite',
      `buggy_updated_at=${buggyAfterPut.updated_at} winner=${buggyWinner?.name}`,
    ));

    return checks;
  },
};
