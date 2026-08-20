import { createHash } from 'crypto';
import { readFile, readdir, stat, rm } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { getByHash, upsertImage, deleteByHash, getAllHashes, setThumbOk } from './db.js';
import { parsePngMeta } from './png-meta.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THUMBS_DIR = join(__dirname, '..', 'data', 'thumbs');

let scanState = {
  scanning: false,
  total: 0,
  processed: 0,
  newCount: 0,
  movedCount: 0,
  deletedCount: 0,
};

export function getScanStatus() {
  return { ...scanState };
}

async function walkDir(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === '.tmp') continue;
      files.push(...await walkDir(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

export async function generateThumb(hash, srcPath) {
  mkdirSync(THUMBS_DIR, { recursive: true });
  const thumbPath = join(THUMBS_DIR, `${hash}.webp`);
  try {
    await sharp(srcPath)
      .resize({ width: 300, height: 300, fit: 'inside' })
      .webp({ quality: 80 })
      .toFile(thumbPath);
    setThumbOk(hash, 1);
  } catch (e) {
    console.warn(`[Scanner] サムネイル生成失敗 ${hash}: ${e.message}`);
  }
}

export async function startScan(vaultRoot) {
  if (scanState.scanning) return;

  scanState = { scanning: true, total: 0, processed: 0, newCount: 0, movedCount: 0, deletedCount: 0 };

  try {
    const files = await walkDir(vaultRoot);
    scanState.total = files.length;

    const dbRows = getAllHashes();
    const dbByHash = new Map(dbRows.map(r => [r.hash, r.rel_path]));
    const fsHashes = new Set();
    const thumbQueue = [];

    for (const filePath of files) {
      try {
        const buf = await readFile(filePath);
        const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
        fsHashes.add(hash);

        const relPath = relative(vaultRoot, filePath).replace(/\\/g, '/');
        const parts = relPath.split('/');
        const filename = parts[parts.length - 1];
        const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

        const existing = getByHash(hash);
        const fileStat = await stat(filePath);
        const now = new Date().toISOString();

        if (!existing) {
          const meta = parsePngMeta(buf);
          upsertImage({
            hash,
            rel_path: relPath,
            filename,
            folder,
            size_bytes: buf.length,
            created_at: fileStat.birthtimeMs ? new Date(fileStat.birthtimeMs).toISOString() : now,
            modified_at: new Date(fileStat.mtimeMs).toISOString(),
            width: meta.width ?? null,
            height: meta.height ?? null,
            prompt: meta.prompt ?? null,
            negative: meta.negative ?? null,
            seed: meta.seed ?? null,
            model: meta.model ?? null,
            steps: meta.steps ?? null,
            scale: meta.scale ?? null,
            sampler: meta.sampler ?? null,
            preset_id: null,
            favorite: 0,
            caption: null,
            thumb_ok: 0,
            indexed_at: now,
          });
          scanState.newCount++;
          thumbQueue.push({ hash, filePath });
        } else if (existing.rel_path !== relPath) {
          const now2 = new Date().toISOString();
          upsertImage({
            ...existing,
            rel_path: relPath,
            filename,
            folder,
            modified_at: new Date(fileStat.mtimeMs).toISOString(),
            indexed_at: now2,
          });
          scanState.movedCount++;
          if (!existing.thumb_ok) thumbQueue.push({ hash, filePath });
        } else if (!existing.thumb_ok) {
          thumbQueue.push({ hash, filePath });
        }
      } catch (e) {
        console.warn(`[Scanner] ファイル処理失敗 ${filePath}: ${e.message}`);
      }
      scanState.processed++;
    }

    // Delete DB entries not found on FS
    for (const [hash] of dbByHash) {
      if (!fsHashes.has(hash)) {
        deleteByHash(hash);
        try { await rm(join(THUMBS_DIR, `${hash}.webp`), { force: true }); } catch {}
        scanState.deletedCount++;
      }
    }

    // Generate thumbnails sequentially
    for (const { hash, filePath } of thumbQueue) {
      await generateThumb(hash, filePath);
    }

    console.log(`[Scanner] 完了: 新規${scanState.newCount}件 移動${scanState.movedCount}件 削除${scanState.deletedCount}件`);
  } catch (e) {
    console.error('[Scanner] エラー:', e.message);
  } finally {
    scanState.scanning = false;
  }
}
