import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

const HARNESS_SRC = `
import { unlinkSync as _rawUnlink, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getImagePath, removeImageRow, upsertImage } from './db.js';
export { upsertImage };

function failableUnlink(p) {
  if (globalThis.__pvtest_fail_unlink?.has(p))
    throw Object.assign(new Error('injected:EACCES'), { code: 'EACCES' });
  _rawUnlink(p);
}

// Correct implementation: files first, DB last (matches current server.js)
export function doDelete(hash, vaultRoot, thumbsDir) {
  const relPath = getImagePath(hash);
  if (!relPath) return null;
  const filePath = join(vaultRoot, ...relPath.split('/'));
  if (existsSync(filePath)) failableUnlink(filePath);
  const thumbPath = join(thumbsDir, hash + '.webp');
  if (existsSync(thumbPath)) failableUnlink(thumbPath);
  removeImageRow(hash);
  return { ok: true };
}

// Buggy implementation: DB first, files second (old bug)
export function doDeleteBuggy(hash, vaultRoot, thumbsDir) {
  const relPath = getImagePath(hash);
  if (!relPath) return null;
  removeImageRow(hash);  // BUG: metadata lost before filesystem deletion completes
  const filePath = join(vaultRoot, ...relPath.split('/'));
  if (existsSync(filePath)) failableUnlink(filePath);
  const thumbPath = join(thumbsDir, hash + '.webp');
  if (existsSync(thumbPath)) failableUnlink(thumbPath);
  return { ok: true };
}
`;

function makeRow(hash, relPath) {
  const now = '2026-09-19T00:00:00.000Z';
  return {
    hash, rel_path: relPath,
    filename: relPath.split('/').pop(), folder: relPath.split('/').slice(0, -1).join('/'),
    size_bytes: 10, created_at: now, modified_at: now,
    width: 64, height: 64, prompt: 'test', negative: null, seed: 1,
    model: 'm', steps: 20, scale: 5, sampler: 'k_euler',
    preset_id: 'p_test', favorite: 1, caption: 'meta must survive', thumb_ok: 1, indexed_at: now,
  };
}

export default {
  issue: 'pv#9',
  title: 'Image deletion must not remove DB row before filesystem deletion succeeds',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-009-delete-order.mjs',

  async verify() {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const tempRoot = mkdtempSync(join(repoRoot, '.phase6b-pv009-'));

    try {
      const serverDir = join(tempRoot, 'server');
      mkdirSync(serverDir, { recursive: true });
      copyFileSync(join(repoRoot, 'server', 'db.js'), join(serverDir, 'db.js'));
      writeFileSync(join(serverDir, 'harness.mjs'), HARNESS_SRC);

      const ts = Date.now();
      const harnessUrl = `${pathToFileURL(join(serverDir, 'harness.mjs')).href}?t=${ts}`;
      const { doDelete, doDeleteBuggy, upsertImage } = await import(harnessUrl);

      const thumbsDir = join(tempRoot, 'thumbs');
      mkdirSync(thumbsDir, { recursive: true });

      const checks = [];

      // ── AC-9-1: original PNG deletion fails → DB row and metadata survive ──────
      {
        const hash = 'pv009ac91test01';
        const vaultDir = join(tempRoot, 'vault-ac91');
        const relPath = 'folder/test91.png';
        mkdirSync(join(vaultDir, 'folder'), { recursive: true });
        const pngPath = join(vaultDir, 'folder', 'test91.png');
        writeFileSync(pngPath, Buffer.from('png91'));
        writeFileSync(join(thumbsDir, hash + '.webp'), Buffer.from('thumb91'));
        upsertImage(makeRow(hash, relPath));

        globalThis.__pvtest_fail_unlink = new Set([pngPath]);
        let threw = false;
        try { doDelete(hash, vaultDir, thumbsDir); } catch { threw = true; }
        globalThis.__pvtest_fail_unlink = undefined;

        // Re-import db since doDelete uses its own db instance from the copy
        const { getByHash: dbGet } = await import(`${pathToFileURL(join(serverDir, 'db.js')).href}?t=${ts}`);
        const rowAfter = dbGet(hash);
        checks.push(check(
          'original PNG unlink failure: DB row is preserved',
          threw && rowAfter != null,
          `threw=${threw} row=${rowAfter ? 'present' : 'deleted'} favorite=${rowAfter?.favorite} caption=${rowAfter?.caption}`,
        ));
        checks.push(check(
          'original PNG unlink failure: application metadata unchanged',
          rowAfter?.favorite === 1 && rowAfter?.caption === 'meta must survive',
          `favorite=${rowAfter?.favorite} caption=${rowAfter?.caption}`,
        ));
      }

      // ── AC-9-2: thumbnail deletion fails → DB row survives ────────────────────
      {
        const hash = 'pv009ac92test01';
        const vaultDir = join(tempRoot, 'vault-ac92');
        const relPath = 'folder/test92.png';
        mkdirSync(join(vaultDir, 'folder'), { recursive: true });
        const pngPath = join(vaultDir, 'folder', 'test92.png');
        const thumbPath = join(thumbsDir, hash + '.webp');
        writeFileSync(pngPath, Buffer.from('png92'));
        writeFileSync(thumbPath, Buffer.from('thumb92'));
        upsertImage(makeRow(hash, relPath));

        globalThis.__pvtest_fail_unlink = new Set([thumbPath]);
        let threw = false;
        try { doDelete(hash, vaultDir, thumbsDir); } catch { threw = true; }
        globalThis.__pvtest_fail_unlink = undefined;

        const { getByHash: dbGet } = await import(`${pathToFileURL(join(serverDir, 'db.js')).href}?t=${ts}`);
        const rowAfter = dbGet(hash);
        checks.push(check(
          'thumbnail unlink failure: DB row is not pre-deleted',
          threw && rowAfter != null,
          `threw=${threw} row=${rowAfter ? 'present' : 'deleted'}`,
        ));
      }

      // ── AC-9-3: all succeed → DB row deleted, consistent state ───────────────
      {
        const hash = 'pv009ac93test01';
        const vaultDir = join(tempRoot, 'vault-ac93');
        const relPath = 'folder/test93.png';
        mkdirSync(join(vaultDir, 'folder'), { recursive: true });
        writeFileSync(join(vaultDir, 'folder', 'test93.png'), Buffer.from('png93'));
        writeFileSync(join(thumbsDir, hash + '.webp'), Buffer.from('thumb93'));
        upsertImage(makeRow(hash, relPath));

        let r = null;
        try { r = doDelete(hash, vaultDir, thumbsDir); } catch {}

        const { getByHash: dbGet } = await import(`${pathToFileURL(join(serverDir, 'db.js')).href}?t=${ts}`);
        const rowAfter = dbGet(hash);
        checks.push(check(
          'all deletions succeed: DB row is removed',
          r != null && rowAfter == null,
          `result=${JSON.stringify(r)} row=${rowAfter ? 'present' : 'deleted'}`,
        ));
      }

      // ── Negative control: DB-first order → metadata lost on file delete failure
      {
        const hash = 'pv009negtest01';
        const vaultDir = join(tempRoot, 'vault-neg');
        const relPath = 'folder/testneg.png';
        mkdirSync(join(vaultDir, 'folder'), { recursive: true });
        const pngPath = join(vaultDir, 'folder', 'testneg.png');
        writeFileSync(pngPath, Buffer.from('pngneg'));
        writeFileSync(join(thumbsDir, hash + '.webp'), Buffer.from('thumbneg'));
        upsertImage(makeRow(hash, relPath));

        globalThis.__pvtest_fail_unlink = new Set([pngPath]);
        let threw = false;
        try { doDeleteBuggy(hash, vaultDir, thumbsDir); } catch { threw = true; }
        globalThis.__pvtest_fail_unlink = undefined;

        const { getByHash: dbGet } = await import(`${pathToFileURL(join(serverDir, 'db.js')).href}?t=${ts}`);
        const rowAfter = dbGet(hash);
        // With DB-first bug: removeImageRow was called before the throw → row is deleted
        checks.push(check(
          'negative control: DB-first order deletes row before file error (old bug reproduced)',
          threw && rowAfter == null,
          `threw=${threw} row=${rowAfter ? 'present-bug-not-detected' : 'deleted-as-expected'}`,
        ));
      }

      // ── Source order check: removeImageRow comes after unlinkSync in server.js ─
      {
        const serverSrc = readFileSync(resolve(repoRoot, 'server.js'), 'utf8');
        // Locate the gallery image delete handler by anchor string then verify relative order
        const anchorStr = "api.delete('/gallery/image/:hash'";
        const anchorIdx = serverSrc.indexOf(anchorStr);
        if (anchorIdx >= 0) {
          // Look within the next 600 chars (enough for the handler body)
          const window = serverSrc.slice(anchorIdx, anchorIdx + 600);
          const idxUnlink = window.indexOf('unlinkSync');
          const idxRemove = window.indexOf('removeImageRow');
          checks.push(check(
            'source: removeImageRow appears after unlinkSync in delete handler',
            idxUnlink > 0 && idxRemove > idxUnlink,
            `unlinkSync@${idxUnlink} removeImageRow@${idxRemove}`,
          ));
        } else {
          checks.push(check('source: removeImageRow appears after unlinkSync in delete handler', false, `anchor '${anchorStr}' not found in server.js`));
        }
      }

      return checks;
    } finally {
      await new Promise(r => setTimeout(r, 200));
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  },
};
