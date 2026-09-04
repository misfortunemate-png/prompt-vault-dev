# prompt-vault フォルダ自動振り分け＋下り同期 Phase A 完了報告

**日時**: 2026-09-04  
**担当**: Claude Sonnet 4.6  
**指示書**: docs/instructions/instructions-pv-folder-and-downsync.md

---

## Phase A: 修正のデプロイ（PG作業）

### 修正1 — handleGenerate に folderSegments/filenameSegments を追加（prompt-vault-dev）

**ファイル**: `src/screens/GenerateScreen.jsx`  
**コミット**: `5cbb59e`

```diff
  const result = await api.generate({
    prompt: pos, negative_prompt: neg,
    model, width: res.width, height: res.height, steps, scale, sampler,
    seed: seed !== '' ? parseInt(seed, 10) : null,
+   folderSegments,
+   filenameSegments,
  });
```

`handleGenerate` 内で算出済みの `folderSegments` / `filenameSegments` を `api.generate()` に追加。  
`api.js` の `generate` 関数は body をそのまま JSON.stringify するため変更不要。

---

### 修正2 — generate.js の folderSegments/filenameSegments パススルー（ai-family-foundation）

**ファイル**: `functions/api/prompt-vault/generate.js`  
**コミット**: `21fbe46`（rebase後 `150192f` として push）

```diff
- folderSegments: [],
- filenameSegments: [],
- preset_id: null,
- label: 'direct generate',
+ folderSegments: body.folderSegments || [],
+ filenameSegments: body.filenameSegments || [],
+ preset_id: body.preset_id || null,
+ label: body.label || 'direct generate',
```

ハードコードの `[]` / `null` / `'direct generate'` を `body` から受け取った値に変更。

---

## デプロイ結果

| リポジトリ | コマンド | バンドル/Version ID | 結果 |
|---|---|---|---|
| prompt-vault-dev | `npm run deploy:pages` | `index-BfqPZlmO.js` | ✅ gh-pages 強制プッシュ完了 |
| ai-family-foundation | `npx wrangler deploy` | `8f26858c-b40f-4d8a-917b-9531486ffd9b` | ✅ Workers デプロイ完了 |

---

## テスト結果

| # | テスト | 合格条件 | 結果 |
|---|---|---|---|
| T-A1 | generate レスポンスに task_id が含まれること | 既存動作確認済み | ✅（前回セッションで確認済み） |
| T-B1 | D1 にフォルダ名が「その他」以外で記録される | PM が curl で確認 | Phase B — PM検収待ち |
| T-B2 | rel_path にカード名由来のフォルダが含まれる | 保存レスポンスで確認 | Phase B — PM検収待ち |
| T-C1〜C3 | 下り同期の実地検証 | フラン上で pv-sync.mjs 実行 | Phase C — PG別作業待ち |

---

## 禁止事項の遵守確認

- `handleAddToQueue`（キュー生成）のコードは変更なし
- DO の `buildFolderFilename` / `alarm()` は変更なし
- `executeSave`（フラン側保存）は変更なし

---

## 備考

Phase B・Phase C は PM / 発注者の実地確認が必要。本報告書は Phase A 完了時点の記録。
