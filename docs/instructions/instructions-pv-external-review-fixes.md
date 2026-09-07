# Prompt Vault 外部レビュー指摘修正 作業指示書
文書種別: 権威文書

作成日: 2026-09-08 ／ PM: クリーデ ／ 本書一枚で完結（追補なし）
起因: 外部レビュー（ChatGPT）による独立コードレビューで8件のIssueが登録された（GitHub Issues #1〜#8）。PMが全件の事実をコード照合で確認済み。

## 添付マニフェスト（着工前照合・必須）

交換所にGitHub Issues #1〜#8が存在すること。支給物なし。

| # | 参照 | 種別 |
|---|---|---|
| 1 | GitHub Issues #1〜#8 | 外部レビュー指摘（事実確認済み） |
| 2 | CLAUDE.md | リポジトリ規約 |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**（本工程は支給物なし）
3. **発注者指示による仕様外修正**: 実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記。権威文書は書き換えない
4. **着工前**: `git pull` → `npm run inspect` 。緑でなければ着工せず報告

## 作業範囲

- **何を**: GitHub Issues #1〜#8の修正（全8件・4フェーズ）
- **なぜ**: ビルド不能（#1）、データ損失リスク（#5,#7,#8）、運用品質（#2,#3,#4,#6）
- **どこで**: prompt-vault-dev（D:\AI\github\prompt-vault-dev）

## 作業手順

**フェーズ順に着手する。各フェーズ完了後にコミットし、次のフェーズへ進む。**

---

### Phase A: ビルド復旧（#1）— 最優先

Issue: `src/screens/AlbumScreen.jsx` が `../lib/thumbDb` をimportしているが、`src/lib/thumbDb.js` がリポジトリに存在しない。mainがビルド不能。

**手順A-1: 診断**

フラン上の作業ツリーを確認する。

```
# prompt-vault-dev ディレクトリで実行
dir src\lib\thumbDb*
git status src/lib/
```

- `src/lib/thumbDb.js` が作業ツリーに存在するがuntracked/unstaged → A-2へ
- 存在しない → A-3へ

**手順A-2: 既存ファイルのpush（存在する場合）**

```
git add src/lib/thumbDb.js
git commit -m "fix(#1): add missing thumbDb.js to repository"
git push
```

A-4へ進む。

**手順A-3: thumbDb.jsの新規作成（存在しない場合）**

AlbumScreen.jsxのimportを確認し、必要なexportを持つモジュールを作成する:

```javascript
// src/lib/thumbDb.js
// IndexedDB thumbnail cache for AlbumScreen
const DB_NAME = 'pv-thumb-cache';
const STORE = 'thumbs';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getThumb(hash) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(hash);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function putThumb(hash, blob) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // cache write failure is non-critical
  }
}
```

AlbumScreen.jsx内の `getThumb` / `putThumb` 呼び出し箇所を確認し、契約（引数・戻り値）が一致することを検証する。不一致があればAlbumScreenの呼び出しに合わせて調整する。

コミット:
```
git add src/lib/thumbDb.js
git commit -m "fix(#1): create thumbDb.js IndexedDB cache module"
git push
```

**手順A-4: ビルド確認**

```
npm run build
npm run build:pages
```

両方が依存解決エラーなく完了すること。失敗したら停止・報告。

コミットメッセージ例: `fix(#1): restore thumbDb module — build passes`

---

### Phase B: データ保全（#5, #7）

#### B-1: ファイル名衝突回避（#5）

`server/generate.js` の `executeSave()` を修正する。

**修正内容**: `copyFileSync` の前に宛先ファイルの存在を確認し、存在する場合はサフィックスを付与して一意にする。

```javascript
// destPath の決定後、copyFileSync の前に挿入
let finalPath = destPath;
let finalFilename = newFilename;
if (existsSync(destPath)) {
  let counter = 1;
  while (existsSync(finalPath)) {
    finalFilename = `${prefix}_${seedStr}_${String(counter).padStart(3, '0')}.png`;
    finalPath = join(destDir, finalFilename);
    counter++;
  }
}
copyFileSync(srcPath, finalPath);
```

以降のDB登録で `rel_path` と `filename` に `finalFilename` / `finalPath` を使うこと。

**検証**: 同一フォルダ・同一prefix・同一seedで2回保存を実行し、2つの異なるPNGが存在することを確認する。

#### B-2: 画像削除の操作順序修正（#7）

`server/db.js` の `deleteImage(hash)` と `server.js` の `DELETE /api/gallery/image/:hash` を修正する。

**修正方針**: FS削除を先に行い、成功後にDB行を削除する。

`server.js` の削除ルート全体を以下の順序に変更する:

```javascript
api.delete('/gallery/image/:hash', (req, res) => {
  const vaultRoot = process.env.VAULT_ROOT;
  if (!vaultRoot) return res.status(400).json({ error: 'VAULT_ROOT未設定' });
  try {
    // 1. DB から rel_path を取得（削除はまだしない）
    const relPath = getImagePath(req.params.hash);  // 新しいヘルパー
    if (!relPath) return res.status(404).json({ error: '画像が見つかりません' });

    // 2. FS削除を先に実行
    const filePath = join(vaultRoot, ...relPath.split('/'));
    if (existsSync(filePath)) unlinkSync(filePath);
    const thumbPath = join(__dirname, 'data', 'thumbs', `${req.params.hash}.webp`);
    if (existsSync(thumbPath)) unlinkSync(thumbPath);

    // 3. FS成功後にDB行を削除
    removeImageRow(req.params.hash);  // 新しいヘルパー
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

`server/db.js` に以下のヘルパーを追加する:

```javascript
export function getImagePath(hash) {
  const row = getDb().prepare('SELECT rel_path FROM images WHERE hash = ?').get(hash);
  return row ? row.rel_path : null;
}

export function removeImageRow(hash) {
  getDb().prepare('DELETE FROM images WHERE hash = ?').run(hash);
}
```

既存の `deleteImage()` は上記2関数に置き換える。他に `deleteImage()` を呼んでいる箇所があれば同様に修正する。

**検証**: 画像削除APIを正常に実行し、DB行とファイルの両方が消えることを確認する。

コミット: `fix(#5,#7): filename collision avoidance and delete order fix`

---

### Phase C: cards/presets updated_at 付与（#8）

Cloud同期（pv-sync.mjs）がcards/presetsの `updated_at` でLWWを判定するが、Fran側CRUDがこの値を生成・更新していない。同期時にFran側の編集が常にCloud側に負ける。

**修正内容**: cards/presets の全CRUDルートで `updated_at` を現在時刻に設定する。

#### C-1: カードCRUD

`server.js` の以下のルートで、アイテム作成・更新時に `updated_at: new Date().toISOString()` を付与する:

- `POST /api/cards/slot` — 新規スロット作成時: `slot` オブジェクトに `updated_at` を追加
- `PUT /api/cards/slot/:id` — スロット更新時: マージ後に `data.slots[idx].updated_at = new Date().toISOString()`
- `POST /api/cards/card` — 新規カード作成時: `card` オブジェクトに `updated_at` を追加
- `PUT /api/cards/card/:id` — カード更新時: マージ後に `data.cards[idx].updated_at = new Date().toISOString()`
- `DELETE /api/cards/card/:id` — 削除時: なし（削除されたカードは消えるのでtimestamp不要。cards.json全体が書き直されるので、他アイテムのupdated_atは変わらない）
- `POST /api/cards/card/:id/duplicate` — 複製時: 新カードに `updated_at` を追加
- `PUT /api/cards` — 全件上書き時: 全スロット・全カードの `updated_at` がなければ現在時刻を設定する

#### C-2: プリセットCRUD

- `POST /api/presets` — 新規作成時: `preset` オブジェクトに `updated_at` を追加
- `PUT /api/presets/:id` — 更新時: マージ後に `data.presets[idx].updated_at = new Date().toISOString()`
- `DELETE /api/presets/:id` — 削除時: なし
- `POST /api/presets/:id/duplicate` — 複製時: 新プリセットに `updated_at` を追加
- `PUT /api/presets` — 全件上書き時: 各プリセットの `updated_at` がなければ現在時刻を設定する

#### C-3: 検証

1. カードを新規作成し、`GET /api/cards` のレスポンスに `updated_at` が含まれることを確認
2. カードを更新し、`updated_at` が更新されていることを確認
3. プリセットについても同様に確認
4. 既存データ（updated_atなし）の `GET /api/cards` が正常にレスポンスを返すことを確認

コミット: `fix(#8): add updated_at to cards/presets CRUD for LWW sync`

---

### Phase D: 運用品質（#2, #3, #4, #6）

#### D-1: README Cloud URL修正（#2）

`README.md` のCloud URL記載を現行の既定値に合わせる:

旧: `https://ai-family-foundation.shogosakamoto.workers.dev`
新: `https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault`

#### D-2: .envフォールバック修正（#3）

`server.js` の .env フォールバック条件を修正する:

```javascript
// 修正前
if (!process.env.VAULT_ROOT && existsSync(_envPath)) {

// 修正後: --env-file で読まれていなければ .env から不足変数を補完
if (existsSync(_envPath)) {
  for (const line of readFileSync(_envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;  // 既存の環境変数は上書きしない
  }
}
```

内側の `if (!process.env[k])` は維持する（OS環境変数の優先は崩さない）。外側のVAULT_ROOT条件だけを除去する。

#### D-3: バージョン整合（#4）

正本は `package.json` の `4.0.0` とする。以下を合わせる:

1. `npm install` を実行して `package-lock.json` を再生成する（root versionが4.0.0になる）
2. `_STATUS.md` のフロントマターを `version: 4.0.0` に更新する
3. `public/sw.js` の `CACHE_NAME` が `prompt-vault-v4.0.0` であることを確認する（既に一致しているはず）

#### D-4: debug/reset ディレクトリ対応（#6）

`server.js` の `POST /api/debug/reset` を修正する:

```javascript
api.post('/debug/reset', (_req, res) => {
  try {
    const dataDir = join(__dirname, 'data');
    for (const f of readdirSync(dataDir)) {
      const fullPath = join(dataDir, f);
      if (statSync(fullPath).isDirectory()) {
        // thumbs等のディレクトリはrmで再帰削除
        rmSync(fullPath, { recursive: true, force: true });
      } else {
        unlinkSync(fullPath);
      }
    }
    mkdirSync(join(dataDir, 'thumbs'), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
```

`rmSync` がimportされていなければ追加する（`node:fs` から）。

コミット: `fix(#2,#3,#4,#6): README URL, .env fallback, version sync, debug reset`

---

## 禁止事項

- CLAUDE.md記載の規約に違反する変更
- 既存APIの公開インターフェース（パス・メソッド・レスポンス構造）の変更（フィールド追加は可）
- フロントUIの変更（本指示の範囲外）

## テスト

- PG自己完結分:
  - `npm run build` / `npm run build:pages` が成功すること（Phase A）
  - 同一prefix・同一seedで2回保存し、別ファイルになること（Phase B-1）
  - `DELETE /api/gallery/image/:hash` が正常動作すること（Phase B-2）
  - カード/プリセットCRUDのレスポンスに `updated_at` が含まれること（Phase C）
  - `GET /api/cards` の既存データが壊れないこと（Phase C）
  - inspectが緑であること
- **実機系（発注者に依頼）**: Pixel 10でCloudflare PagesのフロントUIが正常に動作すること

## 完了条件

- GitHub Issues #1〜#8の修正が全件コミット・push済みであること
- `npm run build` / `npm run build:pages` が成功すること
- inspect緑
- _STATUS.md 更新（version: 4.0.0、milestone: 外部レビュー修正、status: done）
- 各Issueに修正コミットのSHAを記載する必要はない（PMが検査時に確認する）

## 報告基準

報告は docs/reports/ に置く。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約（Phase A〜D各フェーズの結果）
2. 完了条件の各項に対する充足状況
3. inspect結果（緑/赤と出力の添付）
4. 未完了・未検証の項目があれば列挙
5. 発注者指示による仕様外修正があればその旨と内容
6. サーバー再起動・コミット・プッシュの実施状況
7. **Phase A診断結果**: thumbDb.js がフラン上に存在したか否か
8. **Phase B検証結果**: ファイル名衝突テストと削除テストの実施結果
