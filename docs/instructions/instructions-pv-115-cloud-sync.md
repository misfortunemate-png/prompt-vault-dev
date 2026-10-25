# prompt-vault クラウド改修 作業指示書（prompt-vault v4.2.0 ／ foundation）
文書種別: 権威文書

作成日: 2026-10-25 ／ PM: クリーデ（技術顧問席） ／ 対応仕様: docs/prompt-vault-cloud-spec.md ／ 対応要件定義: docs/prompt-vault-cloud-requirements-approved.md ／ 関連Issue: pv#115 ／ 本書一枚で完結（追補なし）

## 添付マニフェスト（着工前照合・必須）

以下がすべて交換所（リポジトリ）に存在すること。**1つでも欠けたら着工せず docs/reports/ に報告。**

| # | パス | 種別 | SHA-256（支給物のみ） |
|---|---|---|---|
| 1 | docs/prompt-vault-cloud-spec.md | 仕様書 | — |
| 2 | docs/prompt-vault-cloud-requirements-approved.md | 承認済み要件定義 | — |
| 3 | prompt-vault-dev #115 | Issue | — |
| 4 | src/lib/crypto.js | 暗号化フォーマット参照 | — |
| 5 | docs/reference/prompt-vault-reference.md | 既存API参照 | — |

支給物なし。

## PG運用規律（定型・全フェーズ共通）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**: PM支給物はdiffゼロで検収される。技術的整合の調整もPMへ差し戻す
3. **発注者指示による仕様外修正**: 発注者から直接指示を受けた修正は実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記する。権威文書は書き換えない
4. **着工前**: 両リポジトリで `git pull` → inspect実行（マニフェスト照合・版確認）。緑でなければ着工しない。着工確認はチャット定型②（process.md §2.6）で発話する
5. **稼働設定の変更三手順**: 稼働中の共有インフラ設定（ポート・serve/funnel等）に触れる場合は、状態記録→スクリプト一本で変更→差分確認の順とする。アドホックなコマンド連打での変異は禁止（#018）

## 作業範囲

- 何を: フランサーバーに同期モジュール（server/sync.js）を内蔵し、選択フォルダの画像をWebP変換・AES-256-GCM暗号化してクラウドへ転送する仕組みを構築する。設定画面にフォルダ選択UI・手動同期ボタンを追加する。既知不具合B-1〜B-3を修正する。旧pv-sync.mjsを廃止する
- なぜ: 旧同期ジョブ（pv-sync）除去後、フラン→クラウドの画像同期が停止している。承認済み要件定義（docs/prompt-vault-cloud-requirements-approved.md）および仕様書（docs/prompt-vault-cloud-spec.md）による
- どこで: prompt-vault-dev（主作業: サーバー・フロント）＋ ai-family-foundation（従作業: pv-sync廃止・Worker確認）

## 影響範囲（PM調査済み——「ここが全部だ」）

### 検索1: `createObjectURL|revokeObjectURL` in src/（B-3関連）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/AlbumScreen.jsx | L98, L120, L211 createObjectURL; L215 revokeObjectURL | 要修正（B-3: unmount時の解放確認） |
| src/screens/GenerateScreen.jsx | L138, L552, L1140 createObjectURL; L145 revokeObjectURL | 要修正（B-3: unmount時の解放確認） |
| src/components/ImageViewer.jsx | L85, L95 createObjectURL; L114, L120 revokeObjectURL | 確認のみ（既にrevoke実装あり） |
| src/lib/api.js | L180 createObjectURL | 確認のみ |
| src/screens/TemplatePresetList.jsx | L38, L46 revokeObjectURL | 対象外（revokeのみ） |
| src/screens/TemplateCardList.jsx | L38, L46 revokeObjectURL | 対象外（revokeのみ） |

### 検索2: `SettingsScreen`（フォルダ選択UI追加先）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/SettingsScreen.jsx | L184 export default function SettingsScreen | 要修正（クラウド同期セクション追加） |
| src/App.jsx | L8 import, L264 usage | 確認のみ |

### 検索3: `connectionRoute`（フラン接続判定）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/GenerateScreen.jsx | 使用箇所あり | 対象外 |
| src/screens/TemplateCardList.jsx | 使用箇所あり | 対象外 |
| src/screens/TemplatePresetList.jsx | 使用箇所あり | 対象外 |
| src/screens/TemplateScreen.jsx | 使用箇所あり | 対象外 |
| src/screens/AlbumScreen.jsx | 使用箇所あり | 対象外 |
| src/App.jsx | 使用箇所あり | 対象外 |

### 検索4: `thumb_ok` in src/（B-2関連）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/AlbumScreen.jsx | L94-139 thumb_ok判定・IndexedDBキャッシュ・フォールバック | 要修正（B-2: thumb_ok=0のプレビュー表示） |

### 検索5: `setLoading|isLoading`（B-1関連）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/GenerateScreen.jsx | 使用箇所あり | 確認のみ |
| src/screens/AlbumScreen.jsx | 使用箇所あり | 要修正（B-1: サムネイル404時のローディング解除） |

### 検索6: `getThumb|/thumbs/` in src/（サムネイル経路）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/lib/api.js | L170 getThumb, L176 cloudUrl + '/thumbs/' | 確認のみ |
| src/lib/connection.js | L331-332 thumb URL routing | 確認のみ |
| src/lib/thumbGen.js | L30 cloud thumb upload | 確認のみ |
| src/lib/thumbDb.js | L19 getThumb | 確認のみ |
| src/components/ImageViewer.jsx | L72 thumb URL construction | 確認のみ |
| src/screens/AlbumScreen.jsx | L7 import, L96/109/202 | 要修正（B-1/B-2関連） |

### 検索7: `encrypt|decrypt` in crypto.js（暗号化フォーマット互換）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/lib/crypto.js | L54 importKey, L82 encrypt(), L88 subtle.encrypt, L98 decrypt() | 確認のみ（server/sync.jsの暗号化はこのフォーマットと同一にする） |

### 検索8: settings.json in server/（フォルダ選択の保存先）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| server.js | L65 SETTINGS_PATH = join(__dirname, 'data', 'settings.json') | 確認のみ（sync.jsからも同じパスを参照） |
| server/queue.js | L10 SETTINGS_PATH | 確認のみ |
| server/genParams.js | L100 settings.json参照 | 確認のみ |

### 検索9: server/ ディレクトリ構成（sync.js新設先）

既存ファイル: db.js, genParams.js, generate.js, log.js, png-meta.js, providers/, queue.js, scanner.js, validate.js
→ sync.js は新設ファイル。既存ファイルとの名前衝突なし。

### 検索10: pv-sync 参照（非.md）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| tests/issues/pv-100-write-guard.mjs | pv-sync参照 | 確認のみ（テストコメント等であれば除去不要） |
| tests/issues/pv-113-key-id-alias.mjs | pv-sync参照 | 確認のみ |
| src/lib/crypto.js | pv-sync参照 | 確認のみ（コメントであれば除去不要） |
| server.js | pv-sync参照 | 確認のみ |

（PMがgrepした結果。PGは表にない箇所を触る場合、停止条件1で報告する）

---

## 作業手順

### Part 1: 同期モジュール新設（server/sync.js）

#### 1-1: vault keyの読み込み

`server/sync.js` を新設する。まずvault keyの読み込みを実装する。

```javascript
import { createCipheriv, randomBytes } from 'node:crypto';

// secrets.env から PV_VAULT_KEY を読む（base64エンコードされた32バイト鍵）
const VAULT_KEY_RAW = process.env.PV_VAULT_KEY
  ? Buffer.from(process.env.PV_VAULT_KEY, 'base64')
  : null;

function assertVaultKey() {
  if (!VAULT_KEY_RAW || VAULT_KEY_RAW.length !== 32) {
    throw Object.assign(new Error('PV_VAULT_KEY が未設定または不正です'), { statusCode: 503 });
  }
  return VAULT_KEY_RAW;
}
```

- `PV_VAULT_KEY` は `D:\AI\secrets\secrets.env` に追加する環境変数
- 鍵の値はフロントの localStorage `pv-vault-key` の `raw` フィールドと同一
- 鍵の値をログ・エラーメッセージに含めない（J-3）
- 32バイトでない場合は503を返す

#### 1-2: 暗号化関数

`src/lib/crypto.js` と**同一のバイナリフォーマット**で暗号化する。フロントの `decrypt()` でそのまま復号できること。

```javascript
const DEFAULT_KEY_ID = 'vault:v1';

function encrypt(plainBuffer, keyBuffer, keyId = DEFAULT_KEY_ID) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  const idBytes = Buffer.from(keyId, 'utf-8');
  const result = Buffer.alloc(1 + idBytes.length + 12 + encrypted.length + tag.length);
  result[0] = idBytes.length;
  idBytes.copy(result, 1);
  iv.copy(result, 1 + idBytes.length);
  encrypted.copy(result, 1 + idBytes.length + 12);
  tag.copy(result, 1 + idBytes.length + 12 + encrypted.length);
  return result;
}
```

**暗号文フォーマット（crypto.jsと同一）:**

```
[1byte: key_id長][key_id UTF-8][12bytes: IV][残り: ciphertext + 認証tag(16bytes)]
```

注意点:
- Web Crypto API（フロント）は `ciphertext` にtagが結合されて返る。Node.jsの `createCipheriv` は `getAuthTag()` で別途取得する。末尾に連結する
- IVは毎回ランダム生成する
- `keyId` は `'vault:v1'` 固定（KEY_ID_ALIASESにより `'v1'` も許容されるが、サーバーは `'vault:v1'` で暗号化する）

#### 1-3: フォルダ選択APIの実装

`data/settings.json` に `sync` キーを追加する。既存の設定読み書き関数があればそれを利用する。

**GET /api/sync/folders**

SQLiteの `images` テーブルから最上位フォルダの一覧と画像数を取得し、`sync.folders` の選択状態と合わせて返す。

```javascript
// SQLiteクエリ例
// folder列は "キャラA/サブフォルダ/..." の形式
// 最上位 = folder を '/' で分割した先頭要素
const rows = db.prepare(`
  SELECT
    substr(folder, 1, instr(folder || '/', '/') - 1) AS top,
    COUNT(*) AS cnt
  FROM images
  GROUP BY top
  ORDER BY top
`).all();
```

レスポンス:
```json
{
  "folders": [
    { "name": "キャラA", "selected": true, "imageCount": 1200 },
    { "name": "キャラB", "selected": false, "imageCount": 800 }
  ]
}
```

**PUT /api/sync/folders**

リクエスト: `{ "folders": ["キャラA", "キャラB"] }`

- `data/settings.json` の `sync.folders` を上書き
- 存在しないフォルダ名が含まれていた場合: C-1/C-2に従い、invalidとして集約先に記録しつつ、有効なフォルダ名のみ保存

```javascript
const knownFolders = new Set(rows.map(r => r.top));
for (const f of requestedFolders) {
  if (!knownFolders.has(f)) {
    recordInvalid({
      kind: 'sync-unknown-folder',
      stage: 'PUT /api/sync/folders',
      raw: f,
      reason: '指定されたフォルダがギャラリーインデックスに存在しない',
    });
  }
}
const validFolders = requestedFolders.filter(f => knownFolders.has(f));
```

#### 1-4: 同期実行API

**POST /api/sync/run**

同期をバックグラウンドで開始する。二重実行防止あり。

```javascript
let syncState = { state: 'idle', lastRun: null, progress: null };

app.post('/api/sync/run', (req, res) => {
  if (syncState.state === 'running') {
    return res.status(409).json({ error: '同期が実行中です' });
  }
  try {
    assertVaultKey();
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }
  syncState = { state: 'running', lastRun: null, progress: { phase: 'scanning', current: 0, total: 0, currentFolder: '' } };
  runSync().catch(err => {
    // エラーをlastRunに記録
  });
  res.json({ started: true });
});
```

**GET /api/sync/status**

`syncState` をそのまま返す。

```json
{ "state": "running", "progress": { "phase": "uploading", "current": 45, "total": 200, "currentFolder": "キャラA" } }
```

または

```json
{ "state": "idle", "lastRun": { "finishedAt": "...", "uploaded": 200, "skipped": 50, "failed": 2, "errors": ["hash abc123: upload failed (503)"] } }
```

#### 1-5: 同期パイプライン（runSync）

`runSync()` は以下の手順で実行する。

**手順1: 対象画像の列挙（scanning）**

1. `sync.folders` から選択済みフォルダを取得
2. SQLiteから選択済みフォルダ（子フォルダ含む）の画像ハッシュを取得:

```javascript
const folders = settings.sync?.folders ?? [];
if (folders.length === 0) {
  syncState = { state: 'idle', lastRun: { finishedAt: new Date().toISOString(), uploaded: 0, skipped: 0, failed: 0, errors: [] } };
  return;
}

// D-5: 最上位フォルダ選択は子フォルダを含む
// folder LIKE 'キャラA/%' OR folder = 'キャラA'
const placeholders = folders.map(() => '(folder = ? OR folder LIKE ?)').join(' OR ');
const params = folders.flatMap(f => [f, f + '/%']);
const localImages = db.prepare(`SELECT hash, folder, filename FROM images WHERE ${placeholders}`).all(...params);
```

3. クラウドの既存画像ハッシュを取得（GET /api/prompt-vault/sync/images、ページング対応）:

```javascript
const cloudHashes = new Set();
let offset = 0;
const limit = 500;
while (true) {
  const res = await fetch(`${CLOUD_BASE}/api/prompt-vault/sync/images?offset=${offset}&limit=${limit}`, {
    headers: { 'Authorization': `Bearer ${CLOUD_TOKEN}` },
  });
  const data = await res.json();
  for (const img of data.images) {
    if (!img.deleted_at) cloudHashes.add(img.hash);
  }
  if (data.images.length < limit) break;
  offset += limit;
}
```

4. 差分を算出（フランにあってクラウドにない画像）:

```javascript
const toUpload = localImages.filter(img => !cloudHashes.has(img.hash));
```

D-3: クラウドにあってフランの選択フォルダにない画像は**そのまま残す**。削除しない。

**手順2: 画像変換・暗号化・アップロード（uploading）**

```javascript
import sharp from 'sharp';

syncState.progress = { phase: 'uploading', current: 0, total: toUpload.length, currentFolder: '' };
const errors = [];
let uploaded = 0;
let skipped = 0;

for (const img of toUpload) {
  try {
    syncState.progress.current++;
    syncState.progress.currentFolder = img.folder.split('/')[0];

    // 1. PNGをディスクから読む
    const pngPath = resolveImagePath(img.hash, img.filename); // 既存の画像パス解決関数を使用
    const pngBuffer = await fs.readFile(pngPath);

    // 2. WebP q80 原寸（D-1: リサイズなし）
    const webpBuffer = await sharp(pngBuffer).webp({ quality: 80 }).toBuffer();

    // 3. サムネイル生成（長辺320px WebP q80）
    const thumbBuffer = await sharp(pngBuffer)
      .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    // 4. 暗号化
    const keyBuffer = assertVaultKey();
    const encryptedWebp = encrypt(webpBuffer, keyBuffer);
    const encryptedThumb = encrypt(thumbBuffer, keyBuffer);

    // 5. クラウドにアップロード（表示用画像）
    await uploadImageToCloud(img.hash, encryptedWebp, {
      filename: img.filename,
      folder: img.folder,
      // 必要に応じてpreset_id, created_at等のメタデータ
    });

    // 6. クラウドにサムネイルをアップロード
    await uploadThumbToCloud(img.hash, encryptedThumb);

    uploaded++;
  } catch (err) {
    errors.push(`hash ${img.hash}: ${err.message}`);
    // 1件の失敗で全体を中断しない
  }
}
```

**uploadImageToCloud / uploadThumbToCloud**:

旧pvImageUpが使用していたWorkerのアップロードエンドポイントを呼ぶ。具体的なエンドポイントは ai-family-foundation のWorkerコードで確認すること。分からない場合は**停止して報告する**。

サムネイルは `PUT /api/prompt-vault/thumbs/{hash}` （既存エンドポイント、instructions-pv-v4.mdで追加済み）。

**手順3: 完了処理**

```javascript
syncState = {
  state: 'idle',
  lastRun: {
    finishedAt: new Date().toISOString(),
    uploaded,
    skipped,
    failed: errors.length,
    errors: errors.slice(0, 20), // エラーが大量の場合は先頭20件に制限
  },
  progress: null,
};
```

#### 1-6: server.jsへのルーティング追加

`server.js` に同期APIのルーティングを追加する。既存エンドポイントの変更は行わない。

```javascript
import { setupSyncRoutes } from './server/sync.js';
// ... 既存のルーティング後に追加
setupSyncRoutes(app, db); // app: Expressインスタンス, db: better-sqlite3インスタンス
```

またはexpressRouter形式でもよい。既存のルーティング構造に合わせること。

#### 1-7: 環境変数の追加

`.env.example` に以下を追記する（値は空にする。J-3: 鍵をハードコードしない）:

```
PV_VAULT_KEY=
```

実際の鍵は `D:\AI\secrets\secrets.env` に `PV_VAULT_KEY=<base64値>` として設定する。この設定は着工時点では不要（PGの自己完結テストでは空転テストとビルド成功を確認する）。

---

### Part 2: フロントUI（src/）

#### 2-1: フォルダ選択UI（SettingsScreen.jsx）

設定画面に「クラウド同期」セクションを追加する。**フラン接続時のみ表示**する。

```jsx
{connectionRoute === 'fran' && (
  <section>
    <h3>クラウド同期</h3>
    <SyncFolderSelector />
    <SyncButton />
  </section>
)}
```

**SyncFolderSelector** コンポーネント（SettingsScreen内またはcomponents/に新設）:

- 画面表示時に `GET /api/sync/folders` を呼ぶ
- 各フォルダをチェックボックスで表示（フォルダ名 + 画像枚数）
- チェック変更はローカルstateに保持
- 「保存」ボタンで `PUT /api/sync/folders` を呼ぶ
- D-5: 最上位フォルダ単位。子フォルダの個別選択UIは設けない

#### 2-2: 同期ボタンと進捗表示

**SyncButton** コンポーネント:

1. 「同期」ボタンを表示
2. ボタン押下で `POST /api/sync/run` を呼ぶ
3. 同期中（state=running）:
   - ボタンをdisabledにする
   - 2〜3秒間隔で `GET /api/sync/status` をポーリング
   - プログレスバー（current / total）と `currentFolder` を表示
4. 同期完了（state=idle, lastRun != null）:
   - ポーリングを停止
   - アップロード数・スキップ数・エラー数を表示
5. エラー時:
   - vault key未設定（503）: 「vault鍵が設定されていません」とトースト表示
   - `lastRun.errors` が空でない場合: エラー件数を表示

```jsx
// ポーリング例
useEffect(() => {
  if (!polling) return;
  const id = setInterval(async () => {
    const res = await fetch('/api/sync/status');
    const data = await res.json();
    setSyncStatus(data);
    if (data.state === 'idle') {
      setPolling(false);
    }
  }, 2500);
  return () => clearInterval(id);
}, [polling]);
```

#### 2-3: 表示制約

- フラン接続時（`connectionRoute === 'fran'`）のみ「クラウド同期」セクションを表示
- クラウド接続時・オフライン時は非表示
- 既存のFran専用UI非表示ルール（boundary-batch Part 2 §2-2で導入済み）に準じる

---

### Part 3: バグ修正（B-1〜B-3）

#### 3-1: B-1 — ビューアのローディング停滞（サムネイル404時）

**現象**: サムネイル取得が404で失敗するとローディングが解除されない。

**修正箇所**: サムネイルのフェッチ処理（AlbumScreen またはビューア関連コンポーネント）のエラーハンドリング。

**修正方針**:

```javascript
// サムネイルフェッチのcatch/errorハンドリング
try {
  const thumbUrl = await api.getThumb(hash);
  setThumbSrc(thumbUrl);
} catch (err) {
  // 404を含むすべてのエラーでローディング状態を解除
  setLoading(false);
  setThumbSrc(null); // プレースホルダー表示にフォールバック
  // エラーを記録（C-2）
  recordInvalid({
    kind: 'thumb-fetch-failed',
    stage: 'B-1 viewer-thumb-load',
    raw: `hash=${hash} status=${err.status ?? 'unknown'}`,
    reason: err.message,
  });
}
```

既存のローディング状態管理の場所に応じて、具体的な修正箇所は異なる。ローディング表示が `isLoading` stateで制御されている場合は、エラー時に `setIsLoading(false)` を確実に呼ぶ。

#### 3-2: B-2 — 新規画像のフォルダプレビュー空表示

**現象**: `thumb_ok=0` の画像しかないフォルダでFolderCardのプレビューが空になる。

**修正方針**: FolderCardのプレビューサムネイル取得で、`thumb_ok=0` の画像についてもフォールバック表示を行う。

選択肢（既存コードの構造に応じて選ぶ）:
- A: `thumb_ok=0` の画像についてプレースホルダー画像を表示する
- B: `thumb_ok=0` の画像はフルサイズ画像からclient-sideでサムネイルを生成する（既存の `generateCloudThumbnail` 関数を利用）

Aが最小変更。Bが理想だが、既存コードとの整合を確認して判断する。判断が困難な場合は停止して報告する。

#### 3-3: B-3 — Blob URLの未解放によるメモリ圧迫

**現象**: `URL.createObjectURL()` で生成したBlob URLが解放されず、モバイル端末のメモリを圧迫する。

**修正方針**: サムネイル表示コンポーネントで、アンマウント時（またはsrc変更時）に `URL.revokeObjectURL()` を確実に呼ぶ。

```jsx
// useEffectでクリーンアップ
useEffect(() => {
  return () => {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
  };
}, [blobUrl]);

// src変更時にも旧URLを解放
useEffect(() => {
  return () => {
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current);
    }
  };
}, [thumbSrc]);
```

修正対象となるコンポーネント（Blob URLを生成するすべての箇所）:
- FolderCard内のPreviewThumb（boundary-batchで追加）
- ビューア内の画像表示
- AlbumScreen内のサムネイルグリッド

batch2指示書の規定「Blob URLはメモリリークの原因になる。コンポーネントのunmount時またはURL不要時に `URL.revokeObjectURL()` を必ず呼ぶ」を徹底する。

---

### Part 4: ai-family-foundation（従作業）

#### 4-1: pv-sync.mjs の廃止

`scripts/pv-sync.mjs` を削除する。2026-09-22にfire-runnerから除去済みであり、本改修でフランサーバーに同期機能が内蔵されるため不要になる。

fire-runner設定・verify-decommission.mjs等に pv-sync.mjs への参照が残っている場合は除去する。

#### 4-2: Worker側の変更確認

同期パイプライン（Part 1-5）で使用する画像アップロードのWorkerエンドポイントを確認する。旧pvImageUpが呼んでいたエンドポイントと同じものを使用する。

エンドポイントが不明な場合、以下を手がかりに特定する:
- `scripts/pv-sync.mjs`（削除前に確認）の `pvImageUp` 関数内のfetch先
- Worker の `functions/api/prompt-vault/` 配下のルーティング

Worker側のコード変更が必要な場合は最小限にとどめる。暗号化バイナリとして受け取るため、PNGからWebPへの変更でWorker側に影響はないはず。影響がある場合は停止して報告する。

---

### コミット指針

#### prompt-vault-dev

```
feat(#115): add server-side sync module with folder selection and manual trigger

- Add server/sync.js with AES-256-GCM encryption (same format as crypto.js)
- Add sync API endpoints: GET/PUT /api/sync/folders, POST /api/sync/run, GET /api/sync/status
- Add folder selection and sync button UI in SettingsScreen (Fran-only)
- Fix B-1: viewer loading state on thumbnail 404
- Fix B-2: folder preview for images with thumb_ok=0
- Fix B-3: revoke Blob URLs on component unmount
```

#### ai-family-foundation

```
chore: remove deprecated pv-sync.mjs

Sync functionality has moved to prompt-vault server (server/sync.js).
pv-sync.mjs was removed from fire-runner on 2026-09-22.
```

---

## 禁止事項

- 新画面の追加（同期設定は既存SettingsScreen内のセクション追加のみ）
- vault keyのログ出力・エラーメッセージへの含有（J-3）
- クラウド側の画像削除（D-3: 同期対象外でも削除しない）
- 自動定期同期の実装（D-4: 手動ボタンのみ）
- handback（Cloud→Fran逆同期）の実装（スコープ外）
- cards/presets/settingsの同期（スコープ外）
- `NOVELAI_API_KEY` 等の鍵をソースコードや `.env.example` にハードコードすること
- 既存エンドポイントの変更・削除

---

## 検証計画（受入基準との対応・これが検収の正になる）

| AC | 検証項目（手順） | 手段 | 証跡様式 | negative control |
|---|---|---|---|---|
| AC-1 | GET /api/sync/folders → フォルダ一覧と画像数が返る | PG実行（curl） | 生ログ | 該当なし |
| AC-2 | PUT /api/sync/folders → GET再取得で選択状態が保持される | PG実行（curl） | 生ログ | 該当なし |
| AC-3 | PV_VAULT_KEY未設定で POST /api/sync/run → 503が返る | PG実行（curl） | 生ログ | 有（鍵設定時は200で開始） |
| AC-4 | 同期中に POST /api/sync/run → 409が返る | PG実行（curl） | 生ログ | 有（idle時は200で開始） |
| AC-5 | 選択フォルダなしで同期 → uploaded:0で正常完了 | PG実行（curl） | 生ログ | 該当なし |
| AC-6 | サーバー暗号化→フロントdecrypt()→元バイナリ一致 | PG実行（テストコード） | テスト出力 | 有（不正鍵で復号失敗） |
| AC-7 | B-1: サムネイル404時にローディングが解除される | PG実行（テストまたはブラウザ） | テスト出力 | 有（404前はローディング表示） |
| AC-8 | B-2: thumb_ok=0のフォルダでプレビューが表示される | PG実行（テストまたはブラウザ） | テスト出力 | 該当なし |
| AC-9 | B-3: コンポーネントunmount時にrevokeObjectURL呼出 | PG実行（console.logまたはテスト） | テスト出力 | 有（unmount前は未解放） |
| AC-10 | npm run build 成功 | PG実行 | 生ログ | 該当なし |
| AC-11 | npm run inspect 既存赤以外に新規赤なし | PG実行 | 生ログ | 該当なし |
| AC-12 | npm run verify:issues 既存結果維持 | PG実行 | 生ログ | 該当なし |

- negative controlは「旧バグ相当で赤の記録→修正後に緑」の両方を証跡に残す
- **実機系（発注者に依頼）**: フラン設定画面でのフォルダ選択→同期実行→Pixel端末でのクラウド閲覧確認、B-1/B-2実機確認、フラン回帰テスト

---

## 完了条件

- server/sync.jsが新設され、vault keyの読み込み・暗号化・同期パイプラインが仕様どおり動作すること
- 同期API（GET/PUT /api/sync/folders、POST /api/sync/run、GET /api/sync/status）が仕様どおり動作すること
- 暗号化バイナリがsrc/lib/crypto.jsのdecrypt()で復号できること（暗号文フォーマット互換）
- SettingsScreenにフォルダ選択UIと同期ボタンが追加され、フラン接続時のみ表示されること
- B-1（ビューアローディング停滞）が修正されていること
- B-2（フォルダプレビュー空表示）が修正されていること
- B-3（Blob URL未解放）が修正されていること
- ai-family-foundationのpv-sync.mjsが削除されていること
- 検証計画の全項目を実行し、証跡を完了報告に添付済み
- 操作スクリプト納品（起動・環境構築・検証はbat/sh＋.env.exampleで自己完結。発注者にコンソール操作をさせない）・サーバー再起動・pull・push実施済み
- inspect緑・_STATUS.mdフロントマター更新

---

## 報告基準

報告は docs/reports/report-pv-115-cloud-sync.md に置く（AC対応表様式）。チャット発話は定型③または④のみ。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約
2. **AC対応表**: | AC | 検証項目 | 結果 | 証跡（生ログ引用 or reports/内パス） |
3. inspect結果（緑/赤と出力の添付）・CI run URL
4. 完了条件の各項に対する充足状況
5. 未完了・未検証の項目があれば列挙（#012・美化しない）
6. 発注者指示による仕様外修正があればその旨と内容
7. サーバー再起動・コミット・プッシュの実施状況
8. Workerデプロイ要否の判定・画像アップロードのWorkerエンドポイント特定結果（Part 4-2）

---

## 発令文（PMがpush後チャットへ転写する）

```
【発令】prompt-vault v4.2.0 — クラウド改修（フォルダ選択同期・画像軽量化・B-1〜B-3）
作業: フランサーバーに同期モジュールを内蔵し、選択フォルダの画像をWebP変換・暗号化してクラウドへ転送する仕組みを構築する
リポジトリ: prompt-vault-dev（指示書・報告）＋ ai-family-foundation（Worker） ／ Issue: pv#115
手順: 両リポジトリで git pull → prompt-vault-dev の docs/instructions/instructions-pv-115-cloud-sync.md を読む
      → マニフェスト照合・inspect緑を確認して着工
報告先: prompt-vault-dev の docs/reports/report-pv-115-cloud-sync.md（AC対応表様式）
```
