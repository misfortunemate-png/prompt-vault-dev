import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function check(name, ok, detail = '') {
  return { name, status: ok ? 'PASS' : 'FAIL', detail };
}

function fixtureRow(hash) {
  const now = '2026-09-12T00:00:00.000Z';
  return {
    hash,
    rel_path: 'fixture.png',
    filename: 'fixture.png',
    folder: '',
    size_bytes: 123,
    created_at: now,
    modified_at: now,
    width: 832,
    height: 1216,
    prompt: 'fixture prompt',
    negative: 'fixture negative',
    seed: 1,
    model: 'fixture-model',
    steps: 28,
    scale: 5,
    sampler: 'k_euler_ancestral',
    preset_id: 'p_phase6b',
    favorite: 1,
    caption: 'must survive unreadable scan',
    thumb_ok: 1,
    indexed_at: now,
  };
}

export default {
  issue: 'pv#40',
  title: 'Scanner preserves SQLite metadata when the Vault cannot be read',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-040-scanner-read-failure.mjs',

  async verify() {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    // Keep the isolated copy under the repository so Node can resolve the
    // repository's installed native dependencies (better-sqlite3, sharp) by
    // walking up to repoRoot/node_modules. The copy has its own data/index.db.
    const tempRoot = mkdtempSync(join(repoRoot, '.phase6b-scanner-'));
    try {
      const serverDir = join(tempRoot, 'server');
      mkdirSync(serverDir, { recursive: true });
      copyFileSync(join(repoRoot, 'server', 'scanner.js'), join(serverDir, 'scanner.js'));
      copyFileSync(join(repoRoot, 'server', 'db.js'), join(serverDir, 'db.js'));
      copyFileSync(join(repoRoot, 'server', 'png-meta.js'), join(serverDir, 'png-meta.js'));

      const db = await import(`${pathToFileURL(join(serverDir, 'db.js')).href}?fixture=${Date.now()}`);
      const scanner = await import(`${pathToFileURL(join(serverDir, 'scanner.js')).href}?fixture=${Date.now()}`);

      const hash = 'phase6bscan00001';
      db.upsertImage(fixtureRow(hash));

      const missingVault = join(tempRoot, 'vault-not-mounted');
      await scanner.startScan(missingVault);
      const afterUnreadable = db.getByHash(hash);

      const checks = [];
      checks.push(check(
        'unreadable/nonexistent Vault root does not delete an existing image row',
        !!afterUnreadable,
        `row_after_unreadable=${afterUnreadable ? 'present' : 'deleted'} scan=${JSON.stringify(scanner.getScanStatus())}`,
      ));
      checks.push(check(
        'application metadata survives an incomplete scan',
        !!afterUnreadable
          && afterUnreadable.favorite === 1
          && afterUnreadable.caption === 'must survive unreadable scan'
          && afterUnreadable.preset_id === 'p_phase6b',
        afterUnreadable
          ? `favorite=${afterUnreadable.favorite} caption=${JSON.stringify(afterUnreadable.caption)} preset_id=${JSON.stringify(afterUnreadable.preset_id)}`
          : 'row was deleted',
      ));

      // A safe fix must not simply disable deletion. When the Vault can be fully
      // enumerated and is genuinely empty, the stale DB row should still be
      // removed by a complete scan.
      db.upsertImage(fixtureRow(hash));
      const emptyVault = join(tempRoot, 'vault-empty-confirmed');
      mkdirSync(emptyVault, { recursive: true });
      await scanner.startScan(emptyVault);
      const afterConfirmedMissing = db.getByHash(hash);
      checks.push(check(
        'complete scan still removes a row for a genuinely missing file',
        !afterConfirmedMissing,
        `row_after_confirmed_empty=${afterConfirmedMissing ? 'present' : 'deleted'} scan=${JSON.stringify(scanner.getScanStatus())}`,
      ));

      return checks;
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  },
};
