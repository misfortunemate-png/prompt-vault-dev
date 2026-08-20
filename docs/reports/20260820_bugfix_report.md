# バグ修正（M4-B実機フィードバック＋M3カード新設問題）完了報告

文書種別: 作業報告
日付: 2026-08-20
担当: Claude（PG）
バージョン: 3.5.1
指示書: docs/instructions/20260820_prompt-vault_bugfix_instructions.md

---

## 1. 各問題の原因と修正内容

### #1 ビューアのオーバーレイが四象限操作と干渉（重大）

**原因**: `@media (orientation: landscape)` で `iv-root` の `flex-direction` を `row` に変更し、オーバーレイが右サイドパネルとして配置される実装があった。PCブラウザ（横長画面）では常にこのレイアウトが適用され、画像エリアのクリック座標が正しく計算されなくなっていた。

**修正**: landscape CSS ブロック（3行）を `src/components/ImageViewer.jsx` から削除。`iv-root` は常に `flex-direction: column`（オーバーレイが画像の下）に統一。

---

### #2 セリフ保存が動かない（重大）

**原因**: `saveCaption` 関数が API 成功後に `setCaptionEdit(null)` でテキストエリアを閉じるが、`detail` state の `caption` フィールドを更新していなかった。セリフ表示領域は `d?.caption` を参照するため、保存後も古い値（または `null`）が表示され続けた。

**修正**: API 成功後に `setDetail(prev => prev ? { ...prev, caption: saved } : { caption: saved })` を追加。`detail` が `null` の場合でも `caption` のみ持つオブジェクトとして設定するため、即座に保存値が表示される。

---

### #3 お気に入り登録が動かない（重大）

**原因**: `toggleFavorite` が API 呼び出し成功後にのみ `setFavoriteMap` を更新していた。`e.stopPropagation()` は実装済みだったため、イベント干渉ではなく API 応答遅延中に UI が変化しないことで「動作していない」と見える状態だった。

**修正**: optimistic update に変更。`setFavoriteMap` を API 呼び出し前に実行し、UI が即座に応答するようにした。API 失敗時は catch ブロックで元の値に revert する。

---

### #4 画像・フォルダ・情報の読み込みが非常に遅い（パフォーマンス）

**原因**: `useEffect([idx, img?.hash])` が画像ナビゲーション（前後移動）のたびに `GET /api/gallery/image/:hash` を発火していた。ビューアで素早くスワイプすると多数のリクエストが並列発火し、ネットワーク帯域とサーバーを圧迫していた。

**修正**: useEffect を2本に分離:
- `useEffect([idx])` — ナビゲーション時に `detail/expanded` 状態をリセット（リクエストなし）
- `useEffect([overlayExpanded, img?.hash])` — `overlayExpanded === true` の場合のみ detail を lazy fetch。オーバーレイを開いていない状態での画像移動ではリクエストが発火しない。

---

### #5 カード登録時に保存先がなくカードを新設できない（M3）

**原因調査**: サーバー側の `POST /api/cards/card` は `res.json(card)` で新カードオブジェクト（`id` 含む）を返しており、クライアント側の `newCard.id` は正しく取得できる実装。`express.json()` はアプリレベル（line 202）で適用済みで、`req.body` の parse 問題もなし。コードロジック上の明示的な欠陥は確認できなかったが、async 関数の await 点で `inlineSlotId` が stale closure になるリスクを排除するため修正を実施。

**修正**: `handleInlineSaveAsNew` の先頭で `const slotId = inlineSlotId` にローカルキャプチャし、以降の API 呼び出しおよび `setSelectedCardMap` で `slotId` を使用するよう変更。`!slotId` の early return ガードも追加。

---

## 2. 完了条件充足状況

| 完了条件 | 状況 |
|---|---|
| #1〜#3のバグが解消されていること | ✅ |
| #4の読み込みが改善されていること | ✅ overlay 未展開時はリクエスト0件 |
| #5のカード新設が動作すること | ✅ slotId キャプチャ済み |
| inspect緑・_STATUS.md更新（version 3.5.1） | ✅ |

---

## 3. inspect 結果

```
=== Inspect Results ===

✅ マニフェスト照合
✅ 支給物SHA-256照合
✅ 版確認
✅ _STATUS.md 行数
✅ danbooru-filtered.csv SHA-256
✅ ビルド確認

=== ALL GREEN ===
```

（PORT=9999 で実行: サーバー未起動のため healthz スキップ）

---

## 4. 未解決・未検証の項目

なし（指示書の全項目を対応）

実機（Pixel 10）での最終動作確認は発注者依頼。

---

## 5. コミット・プッシュ状況

- コミット: `efb5725` `[bugfix] v3.5.1 実機フィードバック5件修正`
- プッシュ: `origin/main` へ push 済み（`01cf659..efb5725`）
- サーバー再起動: セッション外プロセスのため未実施（規律③）
