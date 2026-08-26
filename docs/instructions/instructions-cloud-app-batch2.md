# 文書種別: 権威文書

# prompt-vault クラウド化 アプリPG指示書 第二便（最小コア・フロント側）

作成日: 2026-08-26 ／ PM: クリーデ ／ 対応仕様: ai-family-ops docs/prompt-vault-cloud/spec-prompt-vault-cloud-v1.0.md §5〜§7,§12,§16 ／ 本書一枚で完結（追補なし）

## 添付マニフェスト（着工前照合・必須）

| # | パス | 種別 |
|---|---|---|
| 1 | ai-family-ops docs/prompt-vault-cloud/spec-prompt-vault-cloud-v1.0.md | 仕様書 |
| 2 | ai-family-ops docs/prompt-vault-cloud/api-contract-table-v1.1.md | 契約表 |

## PG運用規律（定型・全フェーズ共通）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**
3. **発注者指示による仕様外修正**: 実施・効果確認してよい。報告時に明記
4. **着工前**: `git pull` → mainブランチ確認。v3.11.0であること

## 作業範囲

- **何を**: クラウド経路での画像復号表示・サムネイル生成・生成応答ハンドリングの配管をフロントに追加する。Tailscale版ExpressにCORS許可ヘッダーを追加する
- **なぜ**: インフラPG（Worker側）と並行で進め、Worker完成後に統合できる状態にする
- **どこで**: prompt-vault-dev（D:\AI\github\prompt-vault-dev）、mainブランチ
- **並行状況**: インフラPGがai-family-foundationで固有基礎工事（V-1〜V-9）を並行実施中。本便のフロント改修はWorker完成前でもフラン経路で動作する

## 作業手順

### 手順1: server.jsのCORS許可ヘッダー追加（M-4）

発注文書M-4: Tailscale版Expressの唯一の改修。別オリジンのWebフロントからフランExpressを呼ぶためのCORSヘッダーを追加する。

```javascript
// server.js の app.use(express.json()) の直後に追加
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  next();
});
```

`.env` に追加（既存項目の後）:
```
ALLOWED_ORIGINS=https://misfortunemate-png.github.io
```

`.env.example` が存在すれば同項目を追加。

**この改修以外にserver.jsを変更してはならない。**

### 手順2: 画像表示の経路分岐

ギャラリー画面（AlbumScreen.jsx）とImageViewer.jsxで画像を表示する箇所に、クラウド経路時の暗号文復号フローを追加する。

**原則**: フラン経路のコードは一切変更しない。`getConnection().route` で分岐し、クラウド経路のみ復号処理を通す。

**サムネイル表示の分岐**:
現行は応答の `thumbUrl`（`/api/thumbs/<hash>.webp`）を `<img src>` に設定している。

```javascript
// フラン経路: 現行どおり（平文webp URL）
// クラウド経路: fetchで暗号文取得→復号→Blob URL
import { getConnection } from '../lib/connection';
import { decrypt } from '../lib/crypto';

async function resolveThumbUrl(thumbUrl) {
  const conn = getConnection();
  if (conn.route !== 'cloud') return thumbUrl; // フラン: そのまま

  // クラウド: thumbUrlはWorkerの相対パス。BASEを付けてfetch
  const fullUrl = conn.cloudUrl + thumbUrl;
  const headers = conn.token ? { 'Authorization': `Bearer ${conn.token}` } : {};
  const res = await fetch(fullUrl, { headers });
  if (!res.ok) throw new Error(`Thumb fetch failed: ${res.status}`);
  const encrypted = await res.arrayBuffer();
  const plain = await decrypt(encrypted);
  const blob = new Blob([plain], { type: 'image/webp' });
  return URL.createObjectURL(blob);
}
```

**重要な制約**:
- Blob URLはメモリリークの原因になる。コンポーネントのunmount時またはURL不要時に `URL.revokeObjectURL()` を必ず呼ぶ
- 一覧表示で50枚同時にfetch+復号すると遅いため、**IntersectionObserver** で画面内に入ったサムネイルのみ復号する（遅延読み込み）。現行がeager loadなら、クラウド経路のみlazy loadにする
- フラン経路ではこの分岐に入らないため、現行の表示速度に影響しない

**原寸画像表示の分岐（ImageViewer）**:
ImageViewerが原寸画像を表示する箇所（`/api/images/full/<hash>` 等）に同様の分岐を追加。

### 手順3: サムネイル生成フロー（クラウド経路）

仕様§5のgenerate応答で、クラウド経路はhashフィールドを含む。生成完了時に端末がサムネイルを作ってR2にPUTする。

```javascript
// 生成完了後のフロー（クラウド経路のみ）
async function generateCloudThumbnail(hash) {
  const conn = getConnection();
  if (conn.route !== 'cloud') return;

  // 1. R2から暗号化画像を取得
  const imgUrl = conn.cloudUrl + `/gallery/image/${hash}/data`;
  const headers = conn.token ? { 'Authorization': `Bearer ${conn.token}` } : {};
  const res = await fetch(imgUrl, { headers });
  const encrypted = await res.arrayBuffer();

  // 2. 復号
  const plain = await decrypt(encrypted);

  // 3. canvas→webp
  const blob = new Blob([plain], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((ok, ng) => { img.onload = ok; img.onerror = ng; img.src = url; });
  URL.revokeObjectURL(url);

  const MAX_W = 320;
  const scale = Math.min(1, MAX_W / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

  const webpBlob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.8));
  const webpBuf = await webpBlob.arrayBuffer();

  // 4. 暗号化→R2にPUT
  const encThumb = await encrypt(new Uint8Array(webpBuf));
  await fetch(conn.cloudUrl + `/thumbs/${hash}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    body: encThumb,
  });
}
```

この関数は生成完了のコールバック内で呼ぶ。失敗してもトーストでエラー通知するだけで生成結果は失われない。

### 手順4: 生成画面のクラウド経路対応

GenerateScreen.jsxの生成完了ハンドリングを分岐する。

**フラン経路**: 現行どおり。`result.image.filename` → `/api/images/.tmp/{filename}` で画像取得。

**クラウド経路**: `result.image.hash` → `/gallery/image/{hash}/data` で暗号文取得→復号→Blob URL表示。生成完了後に `generateCloudThumbnail(hash)` を非同期で呼ぶ。

```javascript
// GenerateScreen の生成完了処理
const conn = getConnection();
if (conn.route === 'cloud' && result.image.hash) {
  // クラウド: hashで暗号文を取得→復号→表示
  const imgUrl = conn.cloudUrl + `/gallery/image/${result.image.hash}/data`;
  const headers = conn.token ? { 'Authorization': `Bearer ${conn.token}` } : {};
  const res = await fetch(imgUrl, { headers });
  const encrypted = await res.arrayBuffer();
  const plain = await decrypt(encrypted);
  const blobUrl = URL.createObjectURL(new Blob([plain], { type: 'image/png' }));
  // blobUrlを結果プレビューに設定
  // ...
  // 非同期でサムネイル生成
  generateCloudThumbnail(result.image.hash).catch(e => addToast('error', `サムネイル生成失敗: ${e.message}`));
} else {
  // フラン: 現行どおり
}
```

### 手順5: キュー画面のクラウド経路対応

キューのタスク結果表示（queueTaskSave後の画像表示）にも同様の分岐を追加する。hash経由で暗号文を取得→復号→表示。

### 手順6: thumbUrl構築の統一

クラウド経路ではWorkerが応答に含める `thumbUrl` が相対パス（`/thumbs/<hash>`）になる。フロント側で完全URLに組み立てる関数を `connection.js` に追加:

```javascript
export function resolveApiUrl(path) {
  const conn = getConnection();
  if (conn.route === 'cloud') return conn.cloudUrl + path;
  return conn.franUrl + path;
}
```

各画面で `thumbUrl` を使う箇所は、この関数で完全URLに変換する。フラン経路では現行の相対パスがそのまま動く（ブラウザがorigin相対で解決する）ため、変換しても壊れない。

## 禁止事項

- server.js のCORS以外の変更
- server/ 配下の変更（CORS以外）
- package.json への依存追加
- フラン経路の既存動作を変える変更（regression）
- 暗号化・復号以外の目的でcrypto.jsを改変

## テスト

### PG自己完結分

1. `npm run dev` で起動→フラン経路（localhost:8789）で生成・アルバム・テンプレートが従来どおり動く（regression確認）
2. CORS: 別オリジンからのfetch（`curl -H 'Origin: https://misfortunemate-png.github.io' -I http://localhost:8789/api/healthz`）でCORSヘッダーが返る
3. `resolveThumbUrl` がフラン経路で既存のURLをそのまま返す
4. `resolveApiUrl` がフラン経路で既存のURLをそのまま返す
5. `npm run build` エラーなし

### 実機系（発注者に依頼）

1. Pixel 10 standaloneで起動→ランプ緑→生成・アルバムが従来どおり動く
2. CORS確認: GitHub Pages版のprompt-vault（もし配備済みなら）からフランへのAPI呼び出しが通る

### 統合テスト（Worker完成後に実施・本便の検収対象外）

- クラウド経路での画像復号表示
- 生成→サムネイル生成→ギャラリー表示
- キュー→結果表示

## 完了条件

1. server.jsにCORS許可ヘッダーが追加されている（M-4）
2. .envにALLOWED_ORIGINS追加
3. AlbumScreen/ImageViewerにクラウド経路の復号分岐が入っている
4. GenerateScreenにクラウド経路のhash対応が入っている
5. connection.jsにresolveApiUrl追加
6. **フラン経路で既存の全機能にregressionがない**
7. `npm run build` エラーなし
8. コミット・push済み（mainブランチ・バージョンは v3.12.0）
9. _STATUS.md 更新（v3.12.0・badge: クラウド最小コア(フロント)・next: Worker統合待ち）

## 報告基準

報告は docs/reports/ に置く。

1. 実装内容の要約
2. 完了条件の各項に対する充足状況
3. npm run build の結果
4. CORSテストの結果（curlの出力）
5. フラン経路でのregression確認結果
6. 未完了・未検証の項目（統合テストは明示的に「Worker完成後」と記載）
7. コミットSHA
