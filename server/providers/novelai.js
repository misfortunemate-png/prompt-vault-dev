import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomInt, randomBytes } from 'crypto';
import { inflateRawSync } from 'zlib';
import { recordEvent, recordInvalid } from '../log.js';

const API_URL = 'https://image.novelai.net/ai/generate-image';
const GENERATE_TIMEOUT_MS = 120_000;

// ZIPローカルファイルヘッダー (PK\x03\x04) を走査してPNGを取得
// 対応圧縮: 0=store, 8=deflate
// bit3フラグ対応: data descriptor (PK\x07\x08) からcompSizeを取得
// S-01・J-10: NovelAI の 2xx 以外の種別。当たらない status は null（残余として INVALID に残す）
export function classifyNovelAiStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'payment';
  if (status === 429) return 'rate-limit';
  if (status >= 500 && status <= 599) return 'server-error';
  return null;
}

function stageOf(origin) {
  return origin === 'queue' ? 'novelai.generate（queue キュー）' : 'novelai.generate（single 単発）';
}

function extractFirstPngFromZip(buffer, stage) {
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer[offset] !== 0x50 || buffer[offset + 1] !== 0x4b ||
        buffer[offset + 2] !== 0x03 || buffer[offset + 3] !== 0x04) {
      offset++;
      continue;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const compression = buffer.readUInt16LE(offset + 8);
    let compSize = buffer.readUInt32LE(offset + 18);
    const fnLen = buffer.readUInt16LE(offset + 26);
    const exLen = buffer.readUInt16LE(offset + 28);
    const fileName = buffer.slice(offset + 30, offset + 30 + fnLen).toString('utf8');
    const dataStart = offset + 30 + fnLen + exLen;

    if (flags & 0x08) {
      for (let i = dataStart; i < buffer.length - 4; i++) {
        if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b &&
            buffer[i + 2] === 0x07 && buffer[i + 3] === 0x08) {
          compSize = i - dataStart;
          break;
        }
      }
    }

    if (/\.png$/i.test(fileName)) {
      const raw = buffer.slice(dataStart, dataStart + compSize);
      if (compression === 0) return raw;
      if (compression === 8) return inflateRawSync(raw);
      throw new Error(`未対応の圧縮方式: ${compression}（${fileName}）`);
    }
    // PNG 以外のエントリは読み飛ばすが、黙らずに残す
    recordInvalid({ kind: 'novelai-zip-non-png-entry', stage: `S-02 ${stage}`, raw: { fileName, compression, compSize }, reason: 'ZIP に PNG 以外のエントリがある（読み飛ばす）' });

    offset = dataStart + compSize;
  }
  throw new Error('ZIPレスポンス内にPNGが見つかりません');
}

export async function generate({ prompt, negativePrompt, model, width, height, steps, scale, sampler, seed, vaultRoot, origin = 'single' }) {
  const stage = stageOf(origin);
  const token = process.env.NOVELAI_TOKEN;
  if (!token) throw new Error('NOVELAI_TOKENが設定されていません');

  const resolvedSeed = (seed != null && seed >= 0) ? seed : randomInt(0, 2 ** 32);
  const isV3 = model === 'nai-diffusion-3';
  const isV5 = model.startsWith('nai-diffusion-5');

  const parameters = {
    width,
    height,
    scale,
    sampler,
    steps,
    seed: resolvedSeed,
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: true,
    dynamic_thresholding: false,
    cfg_rescale: 0,
    noise_schedule: 'karras',
    legacy: false,
    legacy_v3_extend: false,
    use_coords: false,
    negative_prompt: negativePrompt,
  };

  if (!isV3) {
    parameters.params_version = 3;
    parameters.v4_prompt = {
      caption: { base_caption: prompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    };
    parameters.v4_negative_prompt = {
      caption: { base_caption: negativePrompt, char_captions: [] },
    };
  }

  let resp;
  try {
    resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: prompt, model, action: 'generate', parameters }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
  } catch (e) {
    recordEvent({ code: 'NOVELAI_FAILED', kind: 'novelai-network', stage: `S-01 ${stage}`, raw: `${e.name}: ${e.message}`, reason: e.name === 'TimeoutError' ? 'タイムアウト' : '通信失敗' });
    e.novelaiRecorded = true;
    throw e;
  }

  const contentType = resp.headers.get('content-type') || '';
  if (!resp.ok) {
    const errText = await resp.text();
    const cls = classifyNovelAiStatus(resp.status);
    const raw = `status=${resp.status} content-type=${contentType} body=${errText.slice(0, 300)}`;
    if (cls) recordEvent({ code: 'NOVELAI_FAILED', kind: `novelai-${cls}`, stage: `S-01 ${stage}`, raw, reason: `NovelAI が ${resp.status} を返した` });
    else recordInvalid({ kind: 'novelai-unexpected-status', stage: `S-01 ${stage}`, raw, reason: '401/402/403/429/5xx のどれでもない 2xx 以外' });
    const err = new Error(`NovelAI API ${resp.status}: ${errText.slice(0, 300)}`);
    err.novelaiRecorded = true;
    err.kind = cls ? `novelai-${cls}` : 'novelai-unexpected-status';
    throw err;
  }

  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let pngData;
  try {
    pngData = extractFirstPngFromZip(buffer, stage);
  } catch (e) {
    // S-02: 本文の形式の残余。Content-Type と本文の先頭を残す
    recordInvalid({ kind: 'novelai-response-format', stage: `S-02 ${stage}`, raw: `content-type=${contentType} length=${buffer.length} head=${JSON.stringify(buffer.subarray(0, 80).toString('latin1'))}`, reason: e.message });
    e.novelaiRecorded = true;
    throw e;
  }

  const tmpDir = join(vaultRoot, '.tmp');
  mkdirSync(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const hex = randomBytes(4).toString('hex');
  const filename = `tmp_${timestamp}_${hex}.png`;
  writeFileSync(join(tmpDir, filename), pngData);

  return { filename, seed: resolvedSeed, width, height };
}
