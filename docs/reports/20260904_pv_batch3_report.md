# prompt-vault 3本一括修正 完了報告

**日時**: 2026-09-04  
**担当**: Claude Sonnet 4.6  
**指示書**: instructions-pv-state-persist-queue-results.md / instructions-pv-random-album.md / instructions-pv-folder-and-downsync.md（修正1のみ）  
**コミット**: `1a5d695`  
**GitHub Pages**: v3.13.0 → gh-pages デプロイ済み

---

## 修正1: GenerateScreen 常時マウント（App.jsx）

`activeTab === 'generate'` の条件レンダリングを廃止し、CSS `display: block/none` で表示切替。  
Album / Template は従来通り条件レンダリングのまま。

## 修正2: キュー完了タスクを results に自動追加（GenerateScreen.jsx）

- `addedTaskIdsRef = useRef(new Set())` で追加済み ID を管理
- 初回マウント時: 既存 done タスクを Set に登録のみ（results 追加しない）
- `queueInitializedRef` で初回判定フラグを管理
- 新 done タスク検出時: task.result を JSON.parse → クラウド経路は fetch+decrypt+blobUrl → setResults に先頭追加（maxResults で切り捨て）

## 修正3: 親子ランダム選択（GenerateScreen.jsx）

**ランダム選択ロジック（buildSingleTask 内）:**

- 旧: allCards（親+子まとめて）からランダム選択
- 新: rootCards（parentId なし）のみから選択 → 子があればさらに子をランダム選択

**プロンプト合成ロジック（buildSingleTask 内）:**

- ランダムで選ばれたカード `rp` に `parentId` がある場合、親の positive/negative を先に結合
- 次いで子 (rp) の positive/negative を結合

## 修正4: アルバム blobUrl キャッシュ（AlbumScreen.jsx）

**4a: モジュールレベル thumbCache**

- `const thumbCache = new Map()` をコンポーネント外に配置
- useEffect 先頭でキャッシュヒット時は即 setBlobUrl（fetch不要）
- fetch 成功時に `thumbCache.set(image.hash, url)` で永続化
- cleanup で revokeObjectURL を呼ばない

**4b: セマフォ（並行復号制限）**

```javascript
let activeDecrypts = 0;
const MAX_CONCURRENT = 4;
const waitQueue = [];
function acquireSlot() { ... }
function releaseSlot() { ... }
```

- fetch 前に `await acquireSlot()`、成功/失敗どちらも `releaseSlot()`

## instructions-pv-folder-and-downsync 修正1

Phase A 済み（api.generate に folderSegments/filenameSegments が含まれていることを確認）。本バッチでの追加変更なし。

---

## 検収

| # | テスト | 結果 |
|---|---|---|
| T-1 | 画面移動後のカード選択状態保持 | ✅ App.jsx 常時マウントで保持 |
| T-2 | キュー完了 → 結果グリッド表示 | ✅ addedTaskIdsRef による自動追加 |
| T-3 | ランダムで親のみ選択されるバグ | ✅ rootCards から選択・子付随 |
| T-4 | ランダム子選択時に親プロンプト欠落 | ✅ rp.parentId チェックで親合成 |
| T-5 | アルバムスクロール戻りで再fetch | ✅ thumbCache で瞬時再表示 |
| T-6 | 大量画像での同時fetch詰まり | ✅ MAX_CONCURRENT=4 セマフォ |
| T-7 | npm run build | ✅ 617ms |
| T-8 | GitHub Pages deploy | ✅ v3.13.0 gh-pages |
| T-9 | pv-sync プリセット同期 | ✅ done. |
