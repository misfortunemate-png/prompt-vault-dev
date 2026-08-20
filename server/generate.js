import { join } from 'path';
import { readFileSync, mkdirSync, renameSync, existsSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { generate as novelaiGenerate } from './providers/novelai.js';
import { upsertImage } from './db.js';
import { generateThumb } from './scanner.js';
import { parsePngMeta } from './png-meta.js';

function sanitizeSegment(s) {
  let c = String(s).replace(/[/\\:*?"<>|]/g, '_').trim();
  if (c === '..' || c === '.') c = 'unnamed';
  return c || 'unnamed';
}

export async function executeGenerate({ prompt, negativePrompt, model, width, height, steps, scale, sampler, seed, vaultRoot }) {
  return novelaiGenerate({
    prompt: prompt || '',
    negativePrompt: negativePrompt || '',
    model: model || 'nai-diffusion-4-5-full',
    width: width || 832,
    height: height || 1216,
    steps: steps || 28,
    scale: scale || 5,
    sampler: sampler || 'k_euler_ancestral',
    seed: (seed != null && seed >= 0) ? seed : null,
    vaultRoot,
  });
}

export function executeSave(vaultRoot, { filename, seed, folderSegments = [], filenameSegments = [], preset_id = null }) {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('不正なファイル名です');
  }
  const srcPath = join(vaultRoot, '.tmp', filename);
  if (!existsSync(srcPath)) throw new Error('ファイルが見つかりません');

  const validFolders = folderSegments.filter(s => s && s !== '（なし）').map(sanitizeSegment);
  const folderPath = validFolders.length > 0 ? validFolders.join('/') : 'その他';

  const validNames = filenameSegments.filter(s => s && s !== '（なし）').map(sanitizeSegment);
  const prefix = validNames.length > 0 ? validNames.join('_') : 'gen';
  const seedStr = String(seed ?? 0).padStart(10, '0');
  const newFilename = `${prefix}_${seedStr}.png`;

  const destDir = join(vaultRoot, ...folderPath.split('/'));
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, newFilename);
  renameSync(srcPath, destPath);

  try {
    const buf = readFileSync(destPath);
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const meta = parsePngMeta(buf);
    const st = statSync(destPath);
    const now = new Date().toISOString();
    upsertImage({
      hash,
      rel_path: `${folderPath}/${newFilename}`,
      filename: newFilename,
      folder: folderPath,
      size_bytes: buf.length,
      created_at: st.birthtimeMs ? new Date(st.birthtimeMs).toISOString() : now,
      modified_at: new Date(st.mtimeMs).toISOString(),
      width: meta.width ?? null,
      height: meta.height ?? null,
      prompt: meta.prompt ?? null,
      negative: meta.negative ?? null,
      seed: meta.seed ?? (seed != null ? Number(seed) : null),
      model: meta.model ?? null,
      steps: meta.steps ?? null,
      scale: meta.scale ?? null,
      sampler: meta.sampler ?? null,
      preset_id: preset_id || null,
      favorite: 0,
      caption: null,
      thumb_ok: 0,
      indexed_at: now,
    });
    generateThumb(hash, destPath).catch(() => {});
  } catch (dbErr) {
    console.warn('[Save] DB登録失敗:', dbErr.message);
  }

  return { saved_path: `${folderPath}/${newFilename}`, filename: newFilename, folder: folderPath };
}
