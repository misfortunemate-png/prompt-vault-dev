# prompt-vault v4.0.0 リリース指示書

文書種別: 権威文書

作成日: 2026-09-04 ／ PM: クリーデ

## 概要

クラウド統合フェーズの完了として v3.13.0 → v4.0.0 にバージョンバンプする。合わせて、クラウド生成画像のサムネイル自動生成を実装する。アイコンはPMが差し替え済み（public/icon-192.png, icon-512.png）。

## 作業範囲

- prompt-vault-dev: AlbumScreen.jsx, GenerateScreen.jsx, package.json
- ai-family-foundation: thumbs/[hash].js, prompt-vault.js

## 修正内容

### 修正1: Worker — PUT /thumbs/:hash 新規実装（ai-family-foundation）

`functions/api/prompt-vault/thumbs/[hash].js` に `onRequestPut` を追加。端末から暗号化済みwebpサムネイルを受け取り、R2に保存、D1の thumb_ok を更新する。

```javascript
export async function onRequestPut(context) {
  const { env, params, request } = context;
  const hash = params.hash;
  const body = await request.arrayBuffer();
  const r2Key = `prompt-vault/thumbs/${hash}.enc`;
  
  await env.BUCKET.put(r2Key, body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  
  await env.DB.prepare(
    'UPDATE pv_images SET thumb_ok = 1, thumb_r2_key = ? WHERE hash = ?'
  ).bind(r2Key, hash).run();
  
  return Response.json({ ok: true, hash, r2Key });
}
```

`prompt-vault.js` のルーティングに PUT /thumbs/:hash を追加（GETと同じハンドラーファイル）。

### 修正2: フロント — サムネイル自動生成（prompt-vault-dev）

**場所: AlbumScreen.jsx の ThumbCell**

`thumb_ok === 0` のクラウド画像をフル画像から復号・表示した**後**、バックグラウンドでサムネイルを生成・アップロードする。

```javascript
// ThumbCell内、decrypt成功後（blobUrl設定後）
if (!image.thumb_ok && isCloud) {
  generateAndUploadThumb(plain, image.hash, conn).catch(() => {});
}
```

**generateAndUploadThumb 関数**（AlbumScreen.jsx にモジュールレベルで定義）:

```javascript
const thumbGenerated = new Set(); // 二重生成防止

async function generateAndUploadThumb(plainBuffer, hash, conn) {
  if (thumbGenerated.has(hash)) return;
  thumbGenerated.add(hash);
  
  const blob = new Blob([plainBuffer], { type: 'image/png' });
  const img = await createImageBitmap(blob);
  
  // 長辺200pxにリサイズ
  const scale = 200 / Math.max(img.width, img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  
  const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  const webpBuf = await webpBlob.arrayBuffer();
  
  // 暗号化
  const { encrypt } = await import('../lib/crypto.js');
  const encrypted = await encrypt(webpBuf);
  
  // R2にアップロード
  const headers = conn.token ? {
    'Authorization': `Bearer ${conn.token}`,
    'Content-Type': 'application/octet-stream',
  } : {};
  
  await fetch(`${conn.cloudUrl}/thumbs/${hash}`, {
    method: 'PUT', headers, body: encrypted,
  });
}
```

**場所: GenerateScreen.jsx の handleGenerate / キュー完了**

生成結果を保存した後にも同様にサムネイル生成を行う。blobUrlを作る時点で平文データがあるため、そこからcanvasで変換する。共通のgenerateAndUploadThumb関数を `src/lib/thumbGen.js` として切り出してもよい（PG裁量）。

### 修正3: バージョンバンプ

`package.json` の `version` を `"4.0.0"` に変更。

### 修正4: manifest.json の base_url 確認

`start_url` と `scope` が GitHub Pages の配信パスと合っていること。変更が必要なら修正する。

## テスト・検収基準

| # | テスト | 合格条件 |
|---|---|---|
| T-1 | クラウド経路でアルバムを開く。thumb_ok=0 の画像が表示された後、同じ画像を再訪問する | 2回目はサムネイル（webp）で高速表示されること |
| T-2 | T-1の後、Worker側でD1を確認 | 該当hashの thumb_ok が 1、thumb_r2_key が設定されていること |
| T-3 | クラウドで新規生成→保存 | 保存後にサムネイルが自動生成されること |
| T-4 | package.json の version が "4.0.0" であること |
| T-5 | PWAのアイコンが盾＋Vのデザインであること（192, 512） |

## 禁止事項

- アイコンPNGに触らない（PMが配置済み）
- 既存のGETサムネイル取得ロジックに触らない
- サムネイル生成失敗で画像表示をブロックしない（catch で握りつぶす）

## 報告先

docs/reports/ に報告書を置く。
