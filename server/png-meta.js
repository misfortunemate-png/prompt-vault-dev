export function parsePngMeta(buffer) {
  const result = { prompt: null, negative: null, seed: null, model: null, steps: null, scale: null, sampler: null, width: null, height: null };

  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return result;
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return result;

  // IHDR is always first chunk: sig(8) + length(4) + type(4) → width at 16, height at 20
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
          const rest = data.slice(nullIdx + 3); // skip compressionFlag + compressionMethod
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
    offset = dataEnd + 4; // skip CRC
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
      // NAI v4/4.5: キャラクタープロンプトの読み取り
      if (parsed.v4_prompt?.caption?.char_captions?.length) {
        const charParts = parsed.v4_prompt.caption.char_captions
          .map(c => c.char_caption)
          .filter(Boolean);
        if (charParts.length) {
          const base = parsed.v4_prompt.caption.base_caption || result.prompt || '';
          result.prompt = [base, ...charParts].filter(Boolean).join(', ');
        }
      }
      if (parsed.v4_negative_prompt?.caption?.char_captions?.length) {
        const charNegParts = parsed.v4_negative_prompt.caption.char_captions
          .map(c => c.char_caption)
          .filter(Boolean);
        if (charNegParts.length) {
          const baseNeg = parsed.v4_negative_prompt.caption.base_caption || result.negative || '';
          result.negative = [baseNeg, ...charNegParts].filter(Boolean).join(', ');
        }
      }
    } catch {}
  }
}
