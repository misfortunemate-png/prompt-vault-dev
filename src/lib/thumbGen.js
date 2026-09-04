import { encrypt } from './crypto.js';

const thumbGenerated = new Set();

export async function generateAndUploadThumb(plainBuffer, hash, conn) {
  if (thumbGenerated.has(hash)) return;
  thumbGenerated.add(hash);

  const blob = new Blob([plainBuffer], { type: 'image/png' });
  const img = await createImageBitmap(blob);

  const scale = 200 / Math.max(img.width, img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  img.close();

  const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  const encrypted = await encrypt(new Uint8Array(await webpBlob.arrayBuffer()));

  const headers = conn.token ? {
    'Authorization': `Bearer ${conn.token}`,
    'Content-Type': 'application/octet-stream',
  } : { 'Content-Type': 'application/octet-stream' };

  await fetch(`${conn.cloudUrl}/thumbs/${hash}`, {
    method: 'PUT', headers, body: encrypted,
  });
}
