# ④ 同期・境界ロジック一括修正 完了報告書

作成日: 2026-09-10  
担当: PG  
上位指示: docs/instructions/instructions-pv-sync-boundary-batch.md

---

## Part 1 実施結果（ai-family-foundation）

### 変更ファイル

| ファイル | 種別 | コミット |
|---|---|---|
| `functions/api/prompt-vault/sync/images.js` | 新規 | `b6caf19` |
| `functions/api/prompt-vault/gallery/index.js` | 修正 | `8271428` |
| `scripts/pv-sync.mjs` | 全面再構成 | `39ff68a` |

### 実施内容

**1. sync/images API 追加（#8, #9）**  
`GET /api/prompt-vault/sync/images` を新設。全件列挙・caption・preset_id・created_at・deleted_at・paging（offset/limit、最大500件）対応。

**2. gallery API 階層tree化（#13）**  
`GET /api/prompt-vault/gallery` にて `buildFolderTree()` を実装。フォルダパスを昇順ソート後に親子関係を構築し、Franの階層ツリーと同形状を返す。

**3. pv-sync.mjs push/handback 完全再構成（#5, #6, #10, #11）**  
旧コード（pvCardsSync/pvPresetsSync/pvSettingsSync/pvImageDown/pvMetaSync）を全除去。  
新 `runPush()` と `runHandback()` を実装:

- **push**: Fran→Cloud（cards/presets/settings全置換 + pvImageUp差分転送 + baseline記録）
- **handback**: baseline guard（SHA-256不一致でexit 3中止）+ Cloud→Fran全置換 + sync/images全件列挙で画像取込（preset_id/created_at含む #11）+ caption同期（#8）+ tombstone削除（#7）+ baseline削除
- **filterSharedSettings()**: sync.*キーをCloud非送信
- **uniqueFilename()**: ファイル衝突時 _001 サフィックス（#6）
- **BASELINE_PATH**: `data/.pv-sync-baseline.json`
- エントリポイント: `--mode push|handback` のみ。無引数 → usage表示 exit 1

---

## Part 2 実施結果（prompt-vault-dev）

### 変更ファイル

| ファイル | 種別 | コミット |
|---|---|---|
| `src/lib/connection.js` | 修正 | `7c850e5` |
| `src/screens/SettingsScreen.jsx` | 修正 | `1ac16d1` |
| `src/screens/AlbumScreen.jsx` | 修正 | `1ac16d1` |
| `src/screens/GenerateScreen.jsx` | 修正 | `e86bdb9` |
| `src/lib/api.js` | 修正 | `79bef1b` |

### 実施内容

**fix(#10): Cloud接続判定の認証確認**  
`checkReachability()` を修正。Cloud接続判定を healthz HTTP 200 のみから「healthz OK + /settings が token付きリクエストで 200」に変更。token未設定または無効 → offline扱い。  
`fetchReachable()` に token パラメータを追加（optional）。

**fix(#13, #15): Fran専用UI非表示**  
- SettingsScreen: FS書込テストボタンを `{connectionState.route !== 'cloud' && ...}` でラップ
- AlbumScreen: リスキャンボタンを `{connectionRoute !== 'cloud' && ...}` でラップ

**fix(#11): サムネイル取得統一**  
- `api.getThumb(hash)` を追加（api.js）: Cloud→auth fetch+AES-256-GCM decrypt+blobURL / Fran→direct URL
- AlbumScreen FolderCard: フォルダプレビューの `<img src={resolveThumbUrl(hash)}>` を `PreviewThumb` コンポーネントに置換。Cloud接続時はAuthヘッダー付きfetch→decrypt→blobURLを使用

**fix(#16): 接続切替時のqueue state残留修正**  
- GenerateScreen Fran else ブランチ冒頭: `setQueueData({idle})` 追加（verifier: franQueueRefresh guard）
- 追加useEffect: `[connectionRoute]` 変更で queueData + queueExpanded をリセット
- handleGenerate: `routeAtFetch` キャプチャ → setResults前にルート一致確認
- handleSave: 同様の routeAtFetch ガード

---

## 完了条件 充足状況

| # | 条件 | 状況 |
|---|---|---|
| 1 | pv-sync.mjs が push/handback 二操作のみ | ✅ |
| 2 | 旧merge/LWWコード除去 | ✅ |
| 3 | baseline記録・照合・中止実装 | ✅ (exit 3) |
| 4 | Cloud同期API: caption・preset_id・created_at・全件列挙 | ✅ |
| 5 | Cloud folder tree API: Franと同形状 | ✅ |
| 6 | Cloud接続時Fran専用機能非表示 | ✅ |
| 7 | 接続切替時queue state・in-flight残留なし | ✅ |
| 8 | サムネイル取得 共通関数経由に統一 | ✅ (api.getThumb + PreviewThumb) |
| 9 | Issue verifier FAIL→PASS/PASS_WITH_WAIVER | ✅ pv#16 FAIL→PASS |
| 10 | 両リポジトリ inspect 合格 | ✅ 既存2件のみ失敗 |

---

## テスト結果

### PG自己完結分

**node scripts/pv-sync.mjs（引数なし）**
```
Usage: node scripts/pv-sync.mjs --mode push|handback
exit code: 1
```
✅

**npm run build**
```
✓ 51 modules transformed.
✓ built in 650ms
```
✅

**npm run inspect**
```
❌ マニフェスト照合: FAILED（pre-existing）
❌ 支給物SHA-256照合: FAILED（pre-existing）
✅ 版確認 / _STATUS.md行数 / danbooru-filtered.csv / ビルド確認
```
✅ 既存2件の失敗のみ、新規赤なし

**npm run verify:issues**
```
pv#16: FAIL→PASS（全4チェック PASS）
pv#20: PASS_WITH_WAIVER
pv#23: PASS_WITH_WAIVER
SUMMARY fail=0 gated_fail=0
```
✅

### NOT RUN（Workerデプロイ必要 / 実機確認不要）

- `--mode push` の実画像転送テスト
- `--mode handback` の正常系（Cloud→Fran）
- baseline不一致 exit 3 実動確認
- caption同期の実データテスト
- 実ブラウザでのCloud接続切替UI確認

---

## §6-0 適用判断

- `PreviewThumb` コンポーネント追加: 新画面・新操作ではなく、既存FolderCardの内部サムネイル表示を正しく機能させるための内部変更。§6-0抵触なしと判断。

---

## Workerデプロイ要否

**要**: `functions/api/prompt-vault/sync/images.js`（新規）および `gallery/index.js`（修正）の反映には `wrangler deploy` が必要。pv-sync.mjs からのhandback動作確認もデプロイ後に実施可能。
