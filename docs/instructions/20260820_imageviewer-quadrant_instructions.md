# prompt-vault ImageViewer 四象限タップ復元 作業指示書
文書種別: 権威文書

作成日: 2026-08-20 ／ PM: クリーデ（技術顧問席・Fable） ／ 本書一枚で完結

## PG運用規律（定型）

1. 停止条件: 仕様にない判断が必要／技術的に実現困難／難航。報告して指示を待つ
2. 発注者指示による仕様外修正: 実施可。報告時に明記
3. 着工前: `git pull`

## 作業範囲

- 何を: ImageViewerのナビゲーションを四象限タップ方式に変更し、スワイプを無効化する
- なぜ: Chromeでのスワイプ誤作動回避、v2からの操作体系の継承
- 対象ファイル: `src/components/ImageViewer.jsx`, `src/screens/AlbumScreen.jsx`

## 四象限の仕様

画像エリア（iv-image-area）を上下左右の4象限に分割する:

```
┌──────────────┬──────────────┐
│              │              │
│   左上       │   右上       │
│   閉じる     │   次フォルダ  │
│ (カタログへ) │              │
├──────────────┼──────────────┤
│              │              │
│   左下       │   右下       │
│   前画像     │   次画像     │
│              │              │
└──────────────┴──────────────┘
```

分割基準: 画像エリアの中心点（width/2, height/2）を境界とする。

デッドゾーン: 外周10%を維持（現行の誤タップ防止と同じ）。デッドゾーン内のタップは何もしない。

## 作業手順

### Step 1: ImageViewer.jsx — handleImageAreaClick を四象限に変更

現在のhandleImageAreaClick（デッドゾーン→中央帯オーバーレイ切替→左右ナビ）を以下に置き換える:

```javascript
const handleImageAreaClick = useCallback((e) => {
  // セリフ編集中: 画像内モードの位置指定を優先
  if (captionEdit !== null && captionCfg.mode === 'overlay') {
    const rect = e.currentTarget.getBoundingClientRect();
    setCaptionCfg(prev => ({
      ...prev,
      x: Math.round(((e.clientX - rect.left) / rect.width) * 100),
      y: Math.round(((e.clientY - rect.top) / rect.height) * 100),
    }));
    return;
  }
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const w = rect.width;
  const h = rect.height;
  // デッドゾーン: 外周10%
  if (x < w * 0.1 || x > w * 0.9 || y < h * 0.1 || y > h * 0.9) return;
  // 四象限判定
  const isLeft = x < w * 0.5;
  const isTop = y < h * 0.5;
  if (isTop && isLeft) { onClose(); }           // 左上: 閉じる
  else if (isTop && !isLeft) { if (onNextFolder) onNextFolder(); }  // 右上: 次フォルダ
  else if (!isTop && isLeft) { go(-1); }         // 左下: 前画像
  else { go(1); }                                // 右下: 次画像
}, [go, onClose, onNextFolder, captionEdit, captionCfg.mode]);
```

### Step 2: ImageViewer.jsx — propsに onNextFolder を追加

関数シグネチャを変更:
```javascript
export default function ImageViewer({ images, initialIndex, onClose, onNextFolder, onFavoriteToggle, onCaptionSave, addToast, onDelete }) {
```

### Step 3: ImageViewer.jsx — スワイプナビゲーション無効化

handleTouchEnd から単指スワイプによるナビゲーションを削除する。具体的に、以下の行を削除:

```javascript
// 削除: 上スワイプで閉じる
if (captionEdit === null && Math.abs(dy) > 80 && dy < 0 && Math.abs(dx) < Math.abs(dy)) { onClose(); return; }
// 削除: 左右スワイプで画像送り
if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return; }
```

ピンチズームとダブルタップリセットは維持する。handleTouchStart, handleTouchMove のピンチ処理は変更しない。

### Step 4: ImageViewer.jsx — オーバーレイ切替

中央帯タップによるオーバーレイ切替は削除される（四象限に置き換わるため）。オーバーレイの展開/折りたたみは下部の情報バー（ファイル名行）のタップで行える（既存実装、変更不要）。

overlayExpanded関連の分岐をhandleImageAreaClickから削除すること。

### Step 5: AlbumScreen.jsx — handleNextFolder の実装

「次フォルダ」のロジック: **下階層優先、なければ隣のフォルダ**。

```javascript
const handleNextFolder = useCallback(() => {
  // 1. 現在のフォルダに子フォルダがあれば、最初の子に移動
  if (folderData?.subfolders?.length > 0) {
    navigateTo(folderData.subfolders[0].path);
    return;
  }
  // 2. 子フォルダがなければ、ツリーから現在のパスの次の兄弟を探す
  if (!galleryData?.tree || !path) return;
  const nextSibling = findNextSibling(galleryData.tree, path);
  if (nextSibling) navigateTo(nextSibling);
}, [folderData, galleryData, path, navigateTo]);
```

ツリー探索のヘルパー関数（AlbumScreen内に追加）:

```javascript
// ツリーからpathの次の兄弟フォルダのパスを返す。見つからなければnull
function findNextSibling(tree, targetPath) {
  // 再帰的にtreeを探索し、targetPathを含む親ノードを見つけ、その次の兄弟を返す
  function search(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].path === targetPath) {
        // 次の兄弟があればそのパスを返す
        if (i + 1 < nodes.length) return nodes[i + 1].path;
        return null; // 末尾 → なし
      }
      if (nodes[i].children?.length) {
        const found = search(nodes[i].children);
        if (found) return found;
      }
    }
    return null;
  }
  return search(tree);
}
```

### Step 6: AlbumScreen.jsx — ImageViewerに onNextFolder を渡す

```jsx
<ImageViewer
  images={viewer.images}
  initialIndex={viewer.idx}
  onClose={() => setViewer(null)}
  onNextFolder={handleNextFolder}
  onFavoriteToggle={handleFavoriteToggle}
  onCaptionSave={handleCaptionSave}
  addToast={addToast}
  onDelete={handleDelete}
/>
```

## 禁止事項

- ピンチズーム（2本指）の処理を変更しない
- 下部情報バー（iv-overlay）のタップ挙動を変更しない
- セリフ編集中の画像内位置指定を削除しない

## テスト

1. 左上タップ → ビューアが閉じてカタログに戻ること
2. 右上タップ → 子フォルダがあれば最初の子に移動。なければ次の兄弟フォルダに移動
3. 左下タップ → 前の画像に移動
4. 右下タップ → 次の画像に移動
5. 外周10%のタップ → 何も起きないこと（デッドゾーン）
6. スワイプ → 画像送り・閉じるが発生しないこと
7. ピンチズーム → 引き続き動作すること
8. 下部情報バーのタップ → オーバーレイ展開/折りたたみが動くこと
9. セリフ編集中 → 画像タップで位置指定が動くこと

## 完了条件

- 四象限タップでの移動が動作すること
- スワイプによる画像送り・閉じるが無効化されていること
- ビルド・サーバー再起動・コミット・プッシュ実施済み
- _STATUS.md更新
