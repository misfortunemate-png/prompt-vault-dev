// pv#115 B-1・B-2: Cloud の画像取得（認証付き fetch → 2xx 確認 → 復号）の段取り
// 復号関数・fetch・記録先は呼び出し側が渡す（node の verifier からも同じ段取りを試せるようにする）

// 復号した本体の形式。pv#115 以降の同期分は WebP、それ以前とクラウド生成分は PNG なので先頭の数バイトで見分ける
export function sniffImageType(buf, fallback = 'image/png') {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return fallback;
}

// 2xx なら復号した ArrayBuffer、2xx 以外なら記録して null。通信・復号の失敗は例外のまま上げる
export async function fetchDecrypted(url, { headers = {}, fetchImpl = (...a) => fetch(...a), decryptImpl, onStatus }) {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    onStatus?.(res.status);
    return null;
  }
  return decryptImpl(await res.arrayBuffer());
}

// B-1: ビューア。サムネを先に出し、サムネが 404 等で取れなくても本体の取得に進む。
// どの道筋でも最後に onDone を呼ぶ（読み込み中の表示を必ず解除させる）
export async function loadViewerImage({ hash, cloudUrl, headers, fetchImpl, decryptImpl, isCancelled = () => false, onThumb, onFull, onDone, recordStatus, recordError }) {
  const out = { thumb: false, full: false };
  try {
    try {
      const plain = await fetchDecrypted(`${cloudUrl}/thumbs/${hash}`, { headers, fetchImpl, decryptImpl, onStatus: s => recordStatus?.('thumb', s) });
      if (plain && !isCancelled()) { onThumb?.(plain); out.thumb = true; }
    } catch (e) {
      recordError?.('thumb', e);
    }
    if (isCancelled()) return out;
    try {
      const plain = await fetchDecrypted(`${cloudUrl}/gallery/image/${hash}/data`, { headers, fetchImpl, decryptImpl, onStatus: s => recordStatus?.('full', s) });
      if (plain && !isCancelled()) { onFull?.(plain); out.full = true; }
    } catch (e) {
      recordError?.('full', e);
    }
    return out;
  } finally {
    if (!isCancelled()) onDone?.(out);
  }
}

// B-2: フォルダのプレビュー。サムネがない（thumb_ok=0 等）ときは本体を取って代わりに出す。
// 戻り値: { plain, type, fromFull } または null（どちらも取れない）
export async function loadPreviewImage({ hash, cloudUrl, headers, fetchImpl, decryptImpl, recordStatus }) {
  const thumb = await fetchDecrypted(`${cloudUrl}/thumbs/${hash}`, { headers, fetchImpl, decryptImpl, onStatus: s => recordStatus?.('thumb', s) });
  if (thumb) return { plain: thumb, type: 'image/webp', fromFull: false };
  const full = await fetchDecrypted(`${cloudUrl}/gallery/image/${hash}/data`, { headers, fetchImpl, decryptImpl, onStatus: s => recordStatus?.('full', s) });
  if (full) return { plain: full, type: 'image/png', fromFull: true };
  return null;
}
