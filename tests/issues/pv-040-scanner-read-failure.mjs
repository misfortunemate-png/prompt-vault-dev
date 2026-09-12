import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function check(name, ok, detail = '') {
  return { name, status: ok ? 'PASS' : 'FAIL', detail };
}

function fixtureRow(hash, overrides = {}) {
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
    ...overrides,
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
    // Keep under repoRoot so Node resolves better-sqlite3/sharp from node_modules.
    const tempRoot = mkdtempSync(join(repoRoot, '.phase6b-scanner-'));
    try {
      const serverDir = join(tempRoot, 'server');
      mkdirSync(serverDir, { recursive: true });
      copyFileSync(join(repoRoot, 'server', 'scanner.js'), join(serverDir, 'scanner.js'));
      copyFileSync(join(repoRoot, 'server', 'db.js'), join(serverDir, 'db.js'));
      copyFileSync(join(repoRoot, 'server', 'png-meta.js'), join(serverDir, 'png-meta.js'));

      // Injection wrapper: lets the verifier simulate per-path readFile/readdir failures
      // without filesystem permission tricks. Scanner logic is unchanged; only I/O is proxied.
      writeFileSync(join(serverDir, '_fs-inject.mjs'), `
import * as _fsp from 'fs/promises';
export const rm = _fsp.rm;
export const stat = (p, ...a) => _fsp.stat(p, ...a);
export const readFile = (p, ...a) => {
  if (globalThis.__pvtest_fail_readfile?.has(String(p)))
    return Promise.reject(Object.assign(new Error('injected:ENOENT'), { code: 'ENOENT' }));
  return _fsp.readFile(p, ...a);
};
export const readdir = (p, ...a) => {
  if (globalThis.__pvtest_fail_readdir?.has(String(p)))
    return Promise.reject(Object.assign(new Error('injected:EACCES'), { code: 'EACCES' }));
  return _fsp.readdir(p, ...a);
};
`);

      // Patch scanner copy: fs/promises → injection wrapper
      let scannerSrc = readFileSync(join(serverDir, 'scanner.js'), 'utf8');
      scannerSrc = scannerSrc.replace(
        "import { readFile, readdir, stat, rm } from 'fs/promises';",
        "import { readFile, readdir, stat, rm } from './_fs-inject.mjs';",
      );
      writeFileSync(join(serverDir, 'scanner.js'), scannerSrc);

      const ts = Date.now();
      const db = await import(`${pathToFileURL(join(serverDir, 'db.js')).href}?t=${ts}`);
      const scanner = await import(`${pathToFileURL(join(serverDir, 'scanner.js')).href}?t=${ts}`);

      const checks = [];

      // ── Case 1: Vault root unreadable ─────────────────────────────────────────
      // readdir(vaultRoot) throws → walkDir sets incomplete=true → no deletion loop
      const hashRoot = 'phase6bscan00001';
      db.upsertImage(fixtureRow(hashRoot));
      await scanner.startScan(join(tempRoot, 'vault-not-mounted'));
      const afterRootFail = db.getByHash(hashRoot);
      checks.push(check(
        'unreadable/nonexistent Vault root does not delete an existing image row',
        !!afterRootFail,
        `row_after_root_fail=${afterRootFail ? 'present' : 'deleted'} scan=${JSON.stringify(scanner.getScanStatus())}`,
      ));
      checks.push(check(
        'application metadata survives an incomplete scan',
        !!afterRootFail
          && afterRootFail.favorite === 1
          && afterRootFail.caption === 'must survive unreadable scan'
          && afterRootFail.preset_id === 'p_phase6b',
        afterRootFail
          ? `favorite=${afterRootFail.favorite} caption=${JSON.stringify(afterRootFail.caption)} preset_id=${JSON.stringify(afterRootFail.preset_id)}`
          : 'row was deleted',
      ));

      // ── Case 2: Subdirectory readdir failure ──────────────────────────────────
      // Vault root readable but one subdirectory's readdir is injected to fail.
      // Rows for images in that subtree must not be deleted.
      const hashSubdir = 'phase6bsubdir001';
      db.upsertImage(fixtureRow(hashSubdir, { rel_path: 'subdir/image.png', filename: 'image.png', folder: 'subdir' }));
      const subtreeVault = join(tempRoot, 'vault-subtree-fail');
      mkdirSync(join(subtreeVault, 'subdir'), { recursive: true });
      globalThis.__pvtest_fail_readdir = new Set([join(subtreeVault, 'subdir')]);
      await scanner.startScan(subtreeVault);
      globalThis.__pvtest_fail_readdir = undefined;
      const afterSubdirFail = db.getByHash(hashSubdir);
      checks.push(check(
        'subdirectory readdir failure does not delete DB rows for that subtree',
        !!afterSubdirFail,
        `row_after_subdir_fail=${afterSubdirFail ? 'present' : 'deleted'} scan=${JSON.stringify(scanner.getScanStatus())}`,
      ));

      // ── Case 3: Individual file readFile failure ───────────────────────────────
      // File appears in directory listing but readFile is injected to fail.
      // The file's hash cannot be computed → it never enters fsHashes.
      // Without the fix: incomplete stays false → row is deleted. With fix: incomplete=true → row kept.
      const hashFileFail = 'phase6bfile0001';
      db.upsertImage(fixtureRow(hashFileFail, { rel_path: 'secret.png', filename: 'secret.png' }));
      const fileFailVault = join(tempRoot, 'vault-file-fail');
      mkdirSync(fileFailVault, { recursive: true });
      const failFilePath = join(fileFailVault, 'secret.png');
      writeFileSync(failFilePath, Buffer.from('placeholder'));
      globalThis.__pvtest_fail_readfile = new Set([failFilePath]);
      await scanner.startScan(fileFailVault);
      globalThis.__pvtest_fail_readfile = undefined;
      const afterFileFail = db.getByHash(hashFileFail);
      checks.push(check(
        'individual file readFile failure does not delete its DB row',
        !!afterFileFail,
        `row_after_file_fail=${afterFileFail ? 'present' : 'deleted'} scan=${JSON.stringify(scanner.getScanStatus())}`,
      ));

      // ── Case 4: Genuine deletion (complete scan, file truly missing) ──────────
      // A safe fix must not disable deletion. Fully enumerable empty vault must still
      // remove stale DB rows.
      db.upsertImage(fixtureRow(hashRoot));
      const emptyVault = join(tempRoot, 'vault-empty-confirmed');
      mkdirSync(emptyVault, { recursive: true });
      await scanner.startScan(emptyVault);
      const afterConfirmedMissing = db.getByHash(hashRoot);
      checks.push(check(
        'complete scan still removes a row for a genuinely missing file',
        !afterConfirmedMissing,
        `row_after_confirmed_empty=${afterConfirmedMissing ? 'present' : 'deleted'} scan=${JSON.stringify(scanner.getScanStatus())}`,
      ));

      return checks;
    } finally {
      try { db.closeDb?.(); } catch {}
      try { scanner.closeDb?.(); } catch {}
      // Windows: allow OS to release SQLite WAL memory-mapped locks before rmSync
      await new Promise(r => setTimeout(r, 200));
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  },
};
