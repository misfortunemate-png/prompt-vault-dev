# Phase 4独立バグ修正バッチ 完了報告（pv-dev #16〜#23）

作成日: 2026-09-08 ／ PG: Claude Sonnet 4.6

---

## 1. 実装内容の要約

### 手順1: 接続切替時のstate reset（#16, #17）

**#16 — App.jsx**

既存の自動再チェック useEffect の直後に、`connectionState.route` を依存配列とする独立した useEffect を追加。route 変更のたびに `setResults([])` を呼ぶ。

**#17 — AlbumScreen.jsx**

`connectionRoute` 変更の useEffect（L304付近）を修正。`loadRoot()` 呼び出しの前に `setPath/setFlatMode/setFolderData/setViewer/setFavUpdates/setRecentImages/setLoading` を resetKey effect と同じパターンでリセット。

コミット: `7836acb`

### 手順2: .tmp一時ファイルの削除（#18）— **案A採用**

**案A（推奨・採用）**: `server.js` の `initVaultStructure()` に起動時クリーンアップを追加。`.tmp/` 内の mtime が 1 時間以上前のファイルを削除。

**generate.js**: `unlinkSync` を import に追加し、`copyFileSync(srcPath, finalPath)` の直後に `try { unlinkSync(srcPath); } catch {}` を追加。保存が成功した一時ファイルはその場で削除される。

コミット: `bcf002f`

### 手順3: Cloud単発generateのdone task重複追加防止（#19）

`GenerateScreen.jsx` の `handleGenerate` cloud 経由成功パスで、`setResults()` 呼び出しの直前に `if (result.task_id) addedTaskIdsRef.current.add(result.task_id)` を追加。キューポーリングが同じ task を拾っても `addedTaskIdsRef` に既登録のため重複しない。

コミット: `bcf002f`

### 手順4: Fran保存のDB登録失敗をエラーとして返す（#20）

**generate.js**: `dbWarning = null` を try ブロック前に宣言し、catch で `dbWarning = dbErr.message` を設定。return に `warning: dbWarning` を追加。

**server.js** POST `/save`: レスポンスを `{ success, saved_path, warning: saved.warning ?? null }` に変更。

**GenerateScreen.jsx** `handleSave`（fran パス）: `api.saveImage()` の戻り値を `r` に受け取り、`r?.warning` が存在すれば `addToast('warning', ...)` を表示。cloud パスは変更なし（別系統の API）。

コミット: `bcf002f`

### 手順5: favorite解除後のstale state修正（#21）

`AlbumScreen.jsx` の `handleFavoriteToggle` を修正。`val` が falsy（0 or false）の場合、`setFlatMode` で `type === 'favorites'` のフラットモードから当該 hash を除去。delete 後のフォルダ集計 stale は次回遷移で解消されるため省略（指示書どおり）。

コミット: `bcf002f`

### 手順6: thumbDb clearAll追加とキャッシュクリア連携（#22）

**thumbDb.js**: `clearAll()` を追加。`clear()` で全エントリを削除し、失敗時は `indexedDB.deleteDatabase(DB_NAME)` にフォールバック。

**SettingsScreen.jsx**: `clearAll as clearThumbDb` を import し、`handleClearSW` の `caches.delete` ループ後に `await clearThumbDb()` を追加。

コミット: `bcf002f`

### 手順7: Cloudflare Pages preview URL CORS修正（#23）

`server.js` の `ALLOWED_ORIGIN_PATTERNS` を修正。

```
// 修正前
/^https:\/\/([a-z0-9]+-)?prompt-vault-6gr\.pages\.dev$/
// 修正後
/^https:\/\/([a-z0-9]+\.)?prompt-vault-6gr\.pages\.dev$/
```

`-`（ハイフン）を `.`（ドット）に変更。本番 URL（キャプチャグループ 0 回マッチ）は引き続き通過する。

コミット: `bcf002f`

---

## 2. 完了条件の充足状況

| 条件 | 状態 |
|---|---|
| 8件の修正がコミット・push済み | ✅ |
| `npm run build` 成功 | ✅（inspect 内ビルド確認） |
| inspect: 既存2件以外に新規赤なし | ✅ |

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
新規の赤: **0件**

---

## 4. NOT RUN（発注者テスト）

- 接続を Fran→Cloud（またはその逆）に切り替えた後、Generate結果一覧がクリアされること（#16）
- 接続切替後、Album画面がルートから再ロードされること（#17）
- 設定画面の「SWキャッシュクリア」実行後、IndexedDB の `pv-thumb-cache` が消えていること（#22）

---

## 5. 手順2（#18）の採用案

**案A を採用**（起動時クリーンアップ）。

案B（破棄ボタン→DELETE リクエスト）はフロントとサーバーの両方に変更が必要で、破棄しなかった場合（アプリ終了など）には対処できないため、案A の方が確実性が高い。PM推奨でもある。

---

## 6. 手順4（#20）のフロント側warning表示

**実装あり**。`handleSave` の fran パスで `api.saveImage()` の戻り値を受け取り、`r?.warning` が存在すれば `addToast('warning', ...)` を呼ぶ。cloud パスは対象外（cloud 経由保存は `api.saveImage({ task_id })` 形式で別系統）。

---

## 7. コミット・プッシュ状況

| コミット | 内容 |
|---|---|
| `7836acb` | fix(#16,#17): reset state on connection route change |
| `bcf002f` | fix(#18,#19,#20,#21,#22,#23): tmp cleanup, duplicate prevention, stale state, thumbDb clear, CORS |
