import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const check = (name, ok, detail = '') => ({ name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail });

// Distinct byte sequences simulating two different images
const BUF_A = Buffer.from('PV5_IMAGE_A_EXISTING_BYTES_DO_NOT_OVERWRITE_v1');
const BUF_B = Buffer.from('PV5_IMAGE_B_NEW_SAVE_DIFFERENT_CONTENT_V2___');

export default {
  issue: 'pv#5',
  title: 'Same save name+seed must not silently overwrite an existing PNG',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-005-save-overwrite.mjs',

  async verify() {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, '..', '..');
    const tempRoot = mkdtempSync(join(repoRoot, '.phase6b-pv005-'));

    try {
      const serverDir = join(tempRoot, 'server');
      mkdirSync(serverDir, { recursive: true });

      copyFileSync(join(repoRoot, 'server', 'db.js'), join(serverDir, 'db.js'));
      copyFileSync(join(repoRoot, 'server', 'png-meta.js'), join(serverDir, 'png-meta.js'));

      // Patch: stub novelai + generateThumb so executeSave is unit-testable
      let genSrc = readFileSync(join(repoRoot, 'server', 'generate.js'), 'utf8');
      genSrc = genSrc.replace(
        "import { generate as novelaiGenerate } from './providers/novelai.js';",
        "const novelaiGenerate = async () => ({});",
      );
      genSrc = genSrc.replace(
        "import { generateThumb } from './scanner.js';",
        "const generateThumb = async () => {};",
      );

      const ts = Date.now();
      const posGenPath = join(serverDir, 'generate-pos.js');
      writeFileSync(posGenPath, genSrc);
      const { executeSave } = await import(`${pathToFileURL(posGenPath).href}?t=${ts}`);

      const checks = [];

      // ── AC-5-1 positive: existing PNG bytes must survive a same-name save ─────
      const vault1 = join(tempRoot, 'vault-pos');
      mkdirSync(join(vault1, '.tmp'), { recursive: true });
      const destDir1 = join(vault1, 'その他');
      mkdirSync(destDir1, { recursive: true });
      const destFile = 'gen_0000000042.png';
      const destPath1 = join(destDir1, destFile);
      writeFileSync(destPath1, BUF_A);
      writeFileSync(join(vault1, '.tmp', 'src.png'), BUF_B);

      let r1 = null;
      try {
        r1 = executeSave(vault1, {
          filename: 'src.png', seed: 42, folderSegments: [], filenameSegments: [],
        });
      } catch {}

      const afterBytes = existsSync(destPath1) ? readFileSync(destPath1) : null;
      checks.push(check(
        'existing PNG bytes are not overwritten by same-name save',
        afterBytes != null && afterBytes.equals(BUF_A),
        `destBytes=${afterBytes ? (afterBytes.equals(BUF_A) ? 'A=original preserved' : 'B=OVERWRITTEN') : 'missing'}`,
      ));

      // ── AC-5-2 positive: result saved_path differs from collision path ─────────
      const collisionRelPath = 'その他/gen_0000000042.png';
      checks.push(check(
        'save completes and uses a different path than the collision candidate',
        r1 != null && r1.saved_path !== collisionRelPath,
        `saved_path=${r1?.saved_path} collision=${collisionRelPath}`,
      ));

      // ── AC-5-2 positive: actual saved file exists and contains BUF_B ──────────
      if (r1?.saved_path) {
        const savedFile = join(vault1, ...r1.saved_path.split('/'));
        const savedBytes = existsSync(savedFile) ? readFileSync(savedFile) : null;
        checks.push(check(
          'result saved_path on disk contains the saved image bytes',
          savedBytes != null && savedBytes.equals(BUF_B),
          `saved_path=${r1.saved_path} fileExists=${existsSync(savedFile)} bytesMatch=${savedBytes?.equals(BUF_B)}`,
        ));
      } else {
        checks.push(check('result saved_path on disk contains the saved image bytes', false, 'no saved_path returned'));
      }

      // ── Negative control: bypass collision avoidance → overwrite ─────────────
      // Patch: use destPath (conflicting path) instead of finalPath (unique path)
      const negGenSrc = genSrc.replace(
        'copyFileSync(srcPath, finalPath);',
        'copyFileSync(srcPath, destPath); // neg-ctrl: bypass collision avoidance',
      );
      const negGenPath = join(serverDir, 'generate-neg.js');
      writeFileSync(negGenPath, negGenSrc);
      const { executeSave: executeSaveNeg } = await import(`${pathToFileURL(negGenPath).href}?t=${ts + 1}`);

      const vaultNeg = join(tempRoot, 'vault-neg');
      mkdirSync(join(vaultNeg, '.tmp'), { recursive: true });
      const destDirNeg = join(vaultNeg, 'その他');
      mkdirSync(destDirNeg, { recursive: true });
      const destPathNeg = join(destDirNeg, destFile);
      writeFileSync(destPathNeg, BUF_A);
      writeFileSync(join(vaultNeg, '.tmp', 'src.png'), BUF_B);

      try {
        executeSaveNeg(vaultNeg, { filename: 'src.png', seed: 42, folderSegments: [], filenameSegments: [] });
      } catch {}

      const negBytes = existsSync(destPathNeg) ? readFileSync(destPathNeg) : null;
      checks.push(check(
        'negative control: collision bypass causes overwrite (old bug reproduced)',
        negBytes != null && negBytes.equals(BUF_B),
        `bytes=${negBytes ? (negBytes.equals(BUF_B) ? 'B=overwritten as expected' : 'A=still original') : 'missing'}`,
      ));

      return checks;
    } finally {
      await new Promise(r => setTimeout(r, 200));
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  },
};
