# 外部レビュー修正完了報告（Issues #1〜#8）

作成日: 2026-09-08 ／ PG: Claude Sonnet 4.6

---

## 1. 実装内容の要約

### Phase A: ビルド復旧（#1）

**診断結果**: `src/lib/thumbDb.js` はフラン上に存在していた（untracked/unstaged）。A-2 ルートで対応。

`getThumb(hash)` / `putThumb(hash, data)` の契約が AlbumScreen.jsx の呼び出し（L94, L122）と一致することを確認したうえで git add → push。

コミット: `22321fb` — `fix(#1): add missing thumbDb.js to repository`

### Phase B: データ保全（#5, #7）

**B-1 ファイル名衝突回避（#5）**

`server/generate.js` の `executeSave()` に衝突チェックループを追加。`destPath` が既に存在する場合、`prefix_seedStr_001.png` 形式でサフィックスを付与してユニークなパスを決定してから `copyFileSync`。以降の DB 登録（`rel_path`, `filename`）・サムネイル生成も `finalPath` / `finalFilename` を使用。

**B-2 画像削除の操作順序修正（#7）**

`server/db.js` の `deleteImage()` を廃止し、`getImagePath(hash)` + `removeImageRow(hash)` に分割。`server.js` の `DELETE /api/gallery/image/:hash` ルートを「FS削除（ファイル＋サムネイル）→ DB行削除」の順に修正。

コミット: `2e9224b` — `fix(#5,#7): filename collision avoidance and delete order fix`

### Phase C: cards/presets updated_at 付与（#8）

`server.js` の全 CRUD ルートに `updated_at: new Date().toISOString()` を付与:

- `POST /api/cards/slot` — slot オブジェクトに追加
- `PUT /api/cards/slot/:id` — マージ後に付与
- `POST /api/cards/card` — card オブジェクトに追加
- `PUT /api/cards/card/:id` — マージ後に付与
- `POST /api/cards/card/:id/duplicate` — 複製カードに付与
- `PUT /api/cards` — 既存アイテムに `updated_at` がなければ現在時刻を設定
- `POST /api/presets` — preset オブジェクトに追加
- `PUT /api/presets/:id` — マージ後に付与
- `POST /api/presets/:id/duplicate` — 複製プリセットに付与
- `PUT /api/presets` — 既存プリセットに `updated_at` がなければ設定

コミット: `d17461e` — `fix(#8): add updated_at to cards/presets CRUD for LWW sync`

### Phase D: 運用品質（#2, #3, #4, #6）

- **D-1 (#2)**: `README.md` の Cloud URL を `https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault` に修正
- **D-2 (#3)**: `server.js` の .env フォールバック条件から外側の `!process.env.VAULT_ROOT` ガードを除去し、全変数を補完するように修正（既存 OS 環境変数は上書きしない内側ガードは維持）
- **D-3 (#4)**: `npm install` 実行（package-lock.json root version = 4.0.0 を確認）、`_STATUS.md` を `version: 4.0.0` / `milestone: 外部レビュー修正` に更新。`public/sw.js` の `CACHE_NAME` は既に `prompt-vault-v4.0.0`（変更不要）
- **D-4 (#6)**: `server.js` に `rmSync` を import 追加。`POST /api/debug/reset` を `isDirectory()` 判定で分岐し、ディレクトリは `rmSync({ recursive, force })` で再帰削除、ファイルは `unlinkSync`。削除後に `data/thumbs/` を再作成

コミット: `0a98110` — `fix(#2,#3,#4,#6): README URL, .env fallback, version sync, debug reset`

---

## 2. 完了条件の充足状況

| 条件 | 状態 |
|---|---|
| GitHub Issues #1〜#8 修正コミット・push 済み | ✅ |
| `npm run build` 成功 | ✅（inspect 内ビルド確認で確認） |
| `npm run build:pages` 成功 | ✅（inspect ビルド確認に含む） |
| inspect: 既存2件以外に新規の赤なし | ✅ |
| `_STATUS.md` version: 4.0.0・milestone: 外部レビュー修正・status: done | ✅ |

---

## 3. inspect 結果

```
❌ マニフェスト照合: FAILED  ← 既存（別案件）
❌ 支給物SHA-256照合: FAILED ← 既存（別案件）
✅ 版確認
✅ _STATUS.md 行数
✅ danbooru-filtered.csv SHA-256
✅ ビルド確認
```

新規の赤: **0件**（PM 確認済みの既存2件のみ）

---

## 4. 未完了・未検証の項目

以下は「発注者に依頼」に分類されており PG 担当外:

- Pixel 10 での Cloudflare Pages フロントUI 動作確認（実機テスト）
- Phase B-1 の実機衝突テスト（同一 prefix・同一 seed で2回保存）
- Phase B-2 の実機削除テスト（DB行＋ファイル両方消えることの確認）
- Phase C の実機 API テスト（カード/プリセット CRUD の `updated_at` 含有確認）

---

## 5. 発注者指示による仕様外修正

なし。

---

## 6. サーバー再起動・コミット・プッシュの実施状況

| 項目 | 状態 |
|---|---|
| Phase A コミット・push | ✅ `22321fb` |
| Phase B コミット・push | ✅ `2e9224b` |
| Phase C コミット・push | ✅ `d17461e` |
| Phase D コミット・push | ✅ `0a98110` |
| サーバー再起動 | 不要（ローカルサーバー未起動・本番は Cloudflare Workers） |

---

## 7. Phase A 診断結果

`src/lib/thumbDb.js` はフラン上に **存在していた**（untracked/unstaged）。A-2 ルート（git add して push）を適用。

---

## 8. Phase B 検証結果

PG 自己完結の範囲でのコード確認:
- 衝突回避ロジック: `existsSync(destPath)` → ループで `_001`〜形式サフィックス付与を確認
- 削除順序: `getImagePath` → FS削除 → `removeImageRow` の順序をコード上で確認

実機検証（2ファイル生成・削除API実行）は発注者側テストに委ねる。
