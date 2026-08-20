# v3.6.1 実装報告

作成日: 2026-08-20 / 実装: Claude

## 実装要約

### #1 ビューアからカード登録（`src/components/ImageViewer.jsx`）

情報オーバーレイ展開時に「📋 カードに登録」ボタンを追加。タップするとボトムシートダイアログが開き、以下の操作が可能:
- スロット選択プルダウン（既存スロット一覧 + 「＋ 新規スロット」）
- 新規スロット選択時はスロット名入力欄を表示
- カード名（ファイル名からシード部分を除いて事前入力）
- 正プロンプト・負プロンプト（画像のメタデータで事前入力、編集可）
- 新規スロットの場合は `POST /api/cards/slot` → `POST /api/cards/card` の順で実行
- 成功時: トースト「カードを登録しました」

### #2 セリフ表示バグ修正（`src/components/ImageViewer.jsx`）

**原因特定**: オーバーレイ展開時に非同期 detail fetch が開始されるが、fetch 完了前にユーザーがキャプション編集・保存できるケースがある。保存後に遅延した fetch が完了すると `setDetail(staleDetail)` が呼ばれ、保存済みキャプションが上書きされていた（レースコンディション）。

**修正**: `fetchSeqRef` (useRef) を導入。fetch 開始時に seq をインクリメントし、`setDetail` 時に現在の seq と一致する場合のみ更新。`saveCaption` 時も `fetchSeqRef.current++` して pending fetch を無効化。

### #3 画像削除（複数ファイル）

- `server/db.js`: `deleteImage(hash)` — `rel_path` を返してからDBレコード削除
- `server.js`: `DELETE /api/gallery/image/:hash` — FS・DB・サムネイル削除
- `src/lib/api.js`: `deleteGalleryImage(hash)` 追加
- `src/components/ImageViewer.jsx`: 「🗑 削除」ボタン + 確認ダイアログ
- `src/screens/AlbumScreen.jsx`: `handleDelete` コールバック — viewer/recent/folderData/flatMode から即時除去

**idx clamp**: `images` prop が縮小して `idx` が範囲外になった場合、useEffect で自動クランプ（最後の1枚削除時に前の画像を表示）。

### グリッドサイズ制御（`src/screens/AlbumScreen.jsx`） ※発注者指示による追加

- 小(80px) / 中(110px) / 大(160px) プリセットボタン + スライダー(60-200px)
- 画像グリッド: `repeat(auto-fill, minmax(${thumbColMin}px, 1fr))`
- フォルダカードグリッド: `repeat(auto-fill, minmax(${thumbColMin * 2.6}px, 1fr))`（比例スケール）
- `localStorage.pv_thumbColMin` に永続化

## 完了条件充足

| 条件 | 状態 |
|---|---|
| ビューアからカード登録できる | ✅ |
| 新規スロット作成がダイアログ内で完結 | ✅ |
| セリフ表示・編集が正常動作 | ✅（レースコンディション修正済み） |
| 画像削除（FS・DB・サムネイル） | ✅ |
| inspect ALL GREEN | ✅ |
| _STATUS.md 更新 (version 3.6.1) | ✅ |

## inspect 結果

```
=== ALL GREEN ===
```

## 未検証項目

- メタデータなし画像でのカード登録（positive/negative が空になること）: ロジック上は空のまま事前入力されるため動作するはずだが実機未確認
- 画像削除後のリスキャン時の挙動（削除済みファイルはスキャンで `deletedCount` に計上される見込み）

## コミット状況

push 済み（main）
