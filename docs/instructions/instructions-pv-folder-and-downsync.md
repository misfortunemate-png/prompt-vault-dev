# prompt-vault フォルダ自動振り分け＋下り同期実地検証 実装指示書

文書種別: 権威文書

作成日: 2026-09-04 ／ PM: クリーデ

## 背景

クラウド経路の単発生成（handleGenerate → api.generate）で、プロンプトカードの useAsFolder / useInFilename 設定が Worker に送られていない。generate.js が folderSegments / filenameSegments をハードコード `[]` で DO に渡すため、D1 に folder='その他' で記録される。キュー生成（handleAddToQueue → api.queueAdd）は正しく動作している。

また、下り同期（pv_image_down）は仕組みが実装済みだが成功パスが未通過。本指示で修正と検証を一括で行う。

## 作業範囲

- prompt-vault-dev: GenerateScreen.jsx, api.js
- ai-family-foundation: functions/api/prompt-vault/generate.js

## 修正内容

### 修正1: フロントからfolderSegments/filenameSegmentsを送る（prompt-vault-dev）

`src/screens/GenerateScreen.jsx` の `handleGenerate` 内、`api.generate()` 呼び出しに folderSegments, filenameSegments を追加する。これらの変数は同関数内ですでに算出済み。

```javascript
// 変更前
const result = await api.generate({
  prompt: pos, negative_prompt: neg,
  model, width: res.width, height: res.height, steps, scale, sampler,
  seed: seed !== '' ? parseInt(seed, 10) : null,
});

// 変更後
const result = await api.generate({
  prompt: pos, negative_prompt: neg,
  model, width: res.width, height: res.height, steps, scale, sampler,
  seed: seed !== '' ? parseInt(seed, 10) : null,
  folderSegments,
  filenameSegments,
});
```

api.js の `generate` 関数は body をそのまま JSON.stringify するため変更不要。

### 修正2: Worker が受け取ったセグメントを DO に渡す（ai-family-foundation）

`functions/api/prompt-vault/generate.js` の DO へのタスク追加部分を修正。

```javascript
// 変更前
folderSegments: [],
filenameSegments: [],

// 変更後
folderSegments: body.folderSegments || [],
filenameSegments: body.filenameSegments || [],
```

同様に `preset_id` と `label` も渡す:

```javascript
preset_id: body.preset_id || null,
label: body.label || 'direct generate',
```

## テスト・検証手順

### Phase A: 修正のデプロイ（PG作業）

1. prompt-vault-dev: 修正1を実施 → push → GitHub Pages デプロイ
2. ai-family-foundation: 修正2を実施 → push → `wrangler deploy`
3. T-A1: curl で generate のレスポンスに task_id が含まれること（既存確認）

### Phase B: フォルダ振り分けの検証（PM検収）

4. Pixel でカードを選択（useAsFolder チェック済みのスロットがある状態）し、クラウド経路で1枚生成→保存
5. T-B1: Worker の D1 にフォルダ名が「その他」以外で記録されていること（PM が curl で確認）
6. T-B2: 保存後のレスポンスの rel_path にカード名由来のフォルダが含まれること

### Phase C: 下り同期の実地検証（PG作業 → 発注者確認）

7. PG がフラン上で `node scripts/pv-sync.mjs --once --type=pv_image_down` を実行
8. T-C1: 新規画像が vaultRoot 配下の正しいフォルダに配置されること（「その他」ではないフォルダ名）
9. T-C2: 旧テスト画像はエラーでスキップされてもよい（旧鍵問題は既知）
10. T-C3: errors=0 の画像についてフランの rescan が走り、ローカル索引に載ること
11. 発注者: フランのアルバムで下りた画像が見えることを確認

## 既存16件の扱い

D1 に folder='その他' で記録済みの16件は修正しない。下り同期で「その他」フォルダに配置される。以降の新規生成から正しいフォルダが適用される。

## 禁止事項

- handleAddToQueue（キュー生成）のコードに触らない（正常動作中）
- DO の buildFolderFilename / alarm() に触らない（正常動作中）
- executeSave（フラン側保存）に触らない

## 報告先

docs/reports/ に報告書を置く。Phase A〜C の各テスト結果を明記すること。
