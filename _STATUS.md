---
project: prompt-vault
version: 3.6.1
milestone: v3.6.1
status: done
updated: 2026-08-20
---

## M1〜M3: 基盤・生成・カード（完了）

- [x] サーバー骨格・PWA・novelai.js・AlbumScreen・カードシステム

## M4-A / M4-A-fix / M4-B: ギャラリー（完了）

- [x] SQLiteインデックス・サムネイル・リスキャン・フォルダ表示モード切替
- [x] ImageViewer.jsx（スワイプ・ピンチ・オーバーレイ・★・セリフ編集）
- [x] お気に入り・テキスト検索・プリセット別アルバム

## bugfix v3.5.1（完了）

- [x] landscape CSS削除・lazy fetch・★optimistic・caption即時更新・slotId capture

## M5: ジョブキュー（完了）

- [x] server/generate.js: executeGenerate/executeSave共有ロジック
- [x] server/queue.js: インメモリキューエンジン（直列実行・ランダム間隔・エラー中断）
- [x] server.js: 6キューAPIルート追加
- [x] GenerateScreen.jsx: ＋キュー・＋直積・キューパネル・直積ダイアログ

## v3.6.1: ビューア機能拡張（完了）

- [x] ImageViewer: ビューアから📋カードに登録ダイアログ（スロット選択・新規スロット・事前入力）
- [x] ImageViewer: セリフ表示バグ修正（fetchSeqRefで遅延fetch上書きを防止）
- [x] ImageViewer: 🗑削除ボタン（FS・DB・サムネイル削除・AlbumScreenグリッド即時反映）
- [x] AlbumScreen: 画像グリッドサイズ制御（小/中/大プリセット＋スライダー、localStorage永続化）
- [x] server/db.js: deleteImage ヘルパー追加
- [x] server.js: DELETE /api/gallery/image/:hash ルート追加
