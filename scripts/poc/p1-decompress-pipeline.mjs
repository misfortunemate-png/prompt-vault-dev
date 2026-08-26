// PoC P-1: DecompressionStream + PNGメタ解析 + AES-256-GCM暗号化パイプライン
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wallStart = performance.now();

// ---- .env パース (server.js と同方式) ----
const envPath = join(__dirname, '../../.env');
const envText = readFileSync(envPath, 'utf8');
for (const line of envText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  if (!process.env[key]) process.env[key] = val;
}

const NOVELAI_TOKEN = process.env.NOVELAI_TOKEN;
if (!NOVELAI_TOKEN) throw new Error('NOVELAI_TOKEN が .env に設定されていません');

// ---- parsePngMeta (png-meta.js からコピー) ----
function parsePngMeta(buffer) {
  const result = { prompt: null, negative: null, char_prompts: null, seed: null, model: null, steps: null, scale: null, sampler: null, width: null, height: null };
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return result;
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return result;
  if (buffer.length >= 24) {
    result.width = buffer.readUInt32BE(16);
    result.height = buffer.readUInt32BE(20);
  }
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length < 0 || offset + 12 + length > buffer.length) break;
    const type = buffer.slice(offset + 4, offset + 8).toString('latin1');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === 'tEXt' && length > 0) {
      const data = buffer.slice(dataStart, dataEnd);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const keyword = data.slice(0, nullIdx).toString('utf8');
        const text = data.slice(nullIdx + 1).toString('utf8');
        parseNovelAiChunk(keyword, text, result);
      }
    } else if (type === 'iTXt' && length > 0) {
      const data = buffer.slice(dataStart, dataEnd);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const keyword = data.slice(0, nullIdx).toString('utf8');
        const compressionFlag = data[nullIdx + 1];
        if (compressionFlag === 0) {
          const rest = data.slice(nullIdx + 3);
          const langNull = rest.indexOf(0);
          if (langNull !== -1) {
            const rest2 = rest.slice(langNull + 1);
            const transNull = rest2.indexOf(0);
            if (transNull !== -1) {
              const text = rest2.slice(transNull + 1).toString('utf8');
              parseNovelAiChunk(keyword, text, result);
            }
          }
        }
      }
    }
    if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  return result;
}

function parseNovelAiChunk(keyword, text, result) {
  if (keyword === 'Description') {
    if (text) result.prompt = text;
  } else if (keyword === 'Comment') {
    try {
      const parsed = JSON.parse(text);
      if (parsed.prompt != null) result.prompt = parsed.prompt;
      if (parsed.uc != null) result.negative = parsed.uc;
      if (parsed.seed != null) result.seed = Number(parsed.seed);
      if (parsed.steps != null) result.steps = Number(parsed.steps);
      if (parsed.scale != null) result.scale = Number(parsed.scale);
      if (parsed.sampler != null) result.sampler = String(parsed.sampler);
      if (parsed.model != null) result.model = String(parsed.model);
      else if (parsed.model_name != null) result.model = String(parsed.model_name);
      const posChars = parsed.v4_prompt?.caption?.char_captions || [];
      const negChars = parsed.v4_negative_prompt?.caption?.char_captions || [];
      if (posChars.length) {
        const base = parsed.v4_prompt.caption.base_caption || result.prompt || '';
        result.prompt = base || null;
        if (parsed.v4_negative_prompt?.caption?.base_caption != null) {
          result.negative = parsed.v4_negative_prompt.caption.base_caption || null;
        }
        result.char_prompts = posChars.map((c, i) => ({
          positive: c.char_caption || '',
          negative: negChars[i]?.char_caption || '',
        })).filter(c => c.positive || c.negative);
        if (!result.char_prompts.length) result.char_prompts = null;
      }
    } catch {}
  }
}

// ---- ZIP → PNG 展開 (DecompressionStream / store 両方式) ----
async function extractFirstPngFromZipAsync(buffer) {
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
      if (compression === 0) {
        return { pngBuffer: raw, method: 'store' };
      }
      if (compression === 8) {
        // 方式A: DecompressionStream('deflate-raw')
        try {
          const { DecompressionStream } = await import('stream/web');
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();
          writer.write(raw);
          writer.close();
          const chunks = [];
          let done = false;
          while (!done) {
            const { value, done: d } = await reader.read();
            if (value) chunks.push(value);
            done = d;
          }
          const total = chunks.reduce((s, c) => s + c.length, 0);
          const out = new Uint8Array(total);
          let pos = 0;
          for (const c of chunks) { out.set(c, pos); pos += c.length; }
          return { pngBuffer: Buffer.from(out), method: 'DecompressionStream' };
        } catch (e) {
          // 方式A失敗 → store扱いで生データを返す（フォールバック）
          return { pngBuffer: raw, method: 'failed', error: e.message };
        }
      }
      throw new Error(`未対応の圧縮方式: ${compression}`);
    }

    offset = dataStart + compSize;
  }
  throw new Error('ZIPレスポンス内にPNGが見つかりません');
}

// ---- メイン ----
const errors = [];

// 1. NovelAI API 呼び出し
const MODEL = 'nai-diffusion-4-5-curated';
const parameters = {
  width: 64,
  height: 64,
  scale: 5,
  sampler: 'k_euler',
  steps: 1,
  seed: 0,
  n_samples: 1,
  ucPreset: 0,
  qualityToggle: true,
  dynamic_thresholding: false,
  cfg_rescale: 0,
  noise_schedule: 'karras',
  legacy: false,
  legacy_v3_extend: false,
  use_coords: false,
  negative_prompt: '',
  params_version: 3,
  v4_prompt: {
    caption: { base_caption: '1girl', char_captions: [] },
    use_coords: false,
    use_order: true,
  },
  v4_negative_prompt: {
    caption: { base_caption: '', char_captions: [] },
  },
};

const resp = await fetch('https://image.novelai.net/ai/generate-image', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${NOVELAI_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ input: '1girl', model: MODEL, action: 'generate', parameters }),
});

if (!resp.ok) {
  const errText = await resp.text();
  throw new Error(`NovelAI API ${resp.status}: ${errText.slice(0, 300)}`);
}

const arrayBuffer = await resp.arrayBuffer();
const zipBuffer = Buffer.from(arrayBuffer);

// 2. ZIP展開
const { pngBuffer, method, error: decompError } = await extractFirstPngFromZipAsync(zipBuffer);
if (decompError) errors.push(`decompress: ${decompError}`);

// 3. PNGメタ解析
const meta = parsePngMeta(pngBuffer);

// 4. AES-256-GCM 暗号化
const key = await globalThis.crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
);
const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

const encStart = performance.now();
const ciphertext = await globalThis.crypto.subtle.encrypt(
  { name: 'AES-GCM', iv }, key, pngBuffer
);
const encMs = performance.now() - encStart;

// 5. 復号 & round-trip 確認
const decStart = performance.now();
const decrypted = await globalThis.crypto.subtle.decrypt(
  { name: 'AES-GCM', iv }, key, ciphertext
);
const decMs = performance.now() - decStart;

const decryptedBuf = Buffer.from(decrypted);
const roundTripMatch = decryptedBuf.length === pngBuffer.length &&
  decryptedBuf.every((b, i) => b === pngBuffer[i]);

const wallClockMs = performance.now() - wallStart;

const result = {
  p1: {
    success: method !== 'failed' && roundTripMatch,
    decompress_method: method,
    png_size_bytes: pngBuffer.length,
    meta: {
      width: meta.width,
      height: meta.height,
      seed: meta.seed,
      model: meta.model,
    },
    encrypt_ms: Math.round(encMs * 100) / 100,
    decrypt_ms: Math.round(decMs * 100) / 100,
    ciphertext_bytes: ciphertext.byteLength,
    round_trip_match: roundTripMatch,
    wall_clock_total_ms: Math.round(wallClockMs),
    errors,
  },
};

console.log(JSON.stringify(result, null, 2));
