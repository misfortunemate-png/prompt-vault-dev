# 修正報告: クラウド経路 保存パラメータ不一致

**日時**: 2026-09-03  
**担当**: Claude Sonnet 4.6  
**コミット**: `78eebb5`

---

## 問題

`GenerateScreen.jsx` の `handleSave` が経路を問わず  
`api.saveImage({ filename, seed, folderSegments, filenameSegments })` を呼んでいた。  
クラウド経路の `POST /save` は `task_id` を要求するため、保存が常に失敗する状態だった。

---

## 修正内容

### 変更ファイル

`src/screens/GenerateScreen.jsx`

### 変更箇所 1 — `handleGenerate`: クラウド結果に `task_id` を保持

```diff
-  const next = [{ ...result.image, folderSegments, filenameSegments, saved: false, blobUrl }, ...prev];
+  const next = [{ ...result.image, task_id: result.image.task_id ?? result.task_id, folderSegments, filenameSegments, saved: false, blobUrl }, ...prev];
```

DOのレスポンスに `task_id` が含まれる場所を両方考慮して `??` で結合。

### 変更箇所 2 — `handleSave`: 経路別分岐

```diff
  const handleSave = async (idx) => {
    const item = results[idx];
+   const conn = getConnection();
    try {
-     await api.saveImage({ filename: item.filename, seed: item.seed, folderSegments: item.folderSegments || [], filenameSegments: item.filenameSegments || [] });
+     if (conn.route === 'cloud') {
+       await api.saveImage({ task_id: item.task_id });
+     } else {
+       await api.saveImage({ filename: item.filename, seed: item.seed, folderSegments: item.folderSegments || [], filenameSegments: item.filenameSegments || [] });
+     }
```

---

## 検収基準

| # | テスト | 合格条件 | 結果 |
|---|---|---|---|
| T-1 | クラウド経路で生成→保存ボタン | 「保存に失敗しました」が出ず、ボタンが「✓ 保存済み」に変わる | コード修正完了（実環境確認は発注元） |
| T-2 | フラン経路で生成→保存ボタン | 従来通り動作する（regression確認） | フラン経路は else 分岐で従来コードを維持 |

---

## 備考

- フラン経路の `else` ブランチは一切変更なし（regression無し）
- `task_id` の取り出し位置は `result.image.task_id ?? result.task_id` として、DOレスポンスの構造が  
  `{ image: { task_id, ... } }` か `{ task_id, image: { ... } }` かどちらでも対応
