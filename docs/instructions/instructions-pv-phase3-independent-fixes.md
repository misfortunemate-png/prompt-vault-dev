# Prompt Vault 独立バグ修正バッチ（Phase 3レビュー） 作業指示書
文書種別: 権威文書

作成日: 2026-09-08 ／ PM: クリーデ ／ 本書一枚で完結（追補なし）
起因: 外部レビューPhase 3で登録されたIssueのうち、契約正本化とは独立に修正できる6件。

## 添付マニフェスト（着工前照合・必須）

| # | 参照 | 種別 |
|---|---|---|
| 1 | ai-family-foundation GitHub Issues #14, #17, #19, #21 | 外部レビュー指摘 |
| 2 | prompt-vault-dev GitHub Issues #12, #14 | 外部レビュー指摘 |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**（本工程は支給物なし）
3. **発注者指示による仕様外修正**: 実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記。権威文書は書き換えない
4. **着工前**: 各リポジトリで `git pull`。prompt-vault-devは `npm run inspect`（既存2件の赤以外に新規赤がないこと）

## 作業範囲

- **何を**: 6件の独立バグ修正（4件ai-family-foundation、2件prompt-vault-dev）
- **なぜ**: データ関連付けの喪失（#12）、誤結果返却（#17）、D1部分失敗（#14-f）、診断の信頼性（#14-pv, #19, #21）
- **どこで**:
  - ai-family-foundation（D:\AI\github\ai-family-foundation）
  - prompt-vault-dev（D:\AI\github\prompt-vault-dev）
- **触らないもの**: cards/presets契約、folder tree構造、thumbnail処理、接続判定ロジック（これらは別案件）

---

## 作業手順

### 手順1: Cloud単発generateのtask identity修正（foundation #17）

**問題**: `functions/api/prompt-vault/generate.js` が追加したtask IDを保持せず `tasks[tasks.length - 1]` を自taskと仮定。busy queueで他taskの結果を返す。

**修正A — DO add応答にtask IDsを追加**:

`src/worker/do/PvQueue.js` L246-274、add handlerで生成したIDを収集して返す:

```javascript
const ids = [];
for (const t of tasks) {
  const id = crypto.randomUUID();
  ids.push(id);
  this.sql.exec(
    `INSERT INTO tasks (id, status, positive, negative, params, folder_segments, filename_segments, preset_id, label, created_at)
     VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, t.positive || '', t.negative || '',
    JSON.stringify(t.params || {}),
    JSON.stringify(t.folderSegments || []),
    JSON.stringify(t.filenameSegments || []),
    t.preset_id || null, t.label || '', now
  );
}
const total = [...this.sql.exec(`SELECT COUNT(*) as cnt FROM tasks`)][0]?.cnt || 0;
return Response.json({ success: true, added: tasks.length, total, ids });
```

（#19のtotal欠落もここで同時修正）

**修正B — generate.jsでtask IDをポーリング**:

`functions/api/prompt-vault/generate.js` で、add応答からIDを取得し、ポーリングでそのIDのstatusを追跡する:

```javascript
const addData = await addResp.json();
const taskId = addData.ids?.[0];
if (!taskId) {
  return Response.json({ error: 'タスクID取得失敗' }, { status: 500 });
}
```

ポーリング部分を、全taskリスト末尾ではなくtaskIdで検索に変更する。DO status応答のtasks配列からIDで探す:

```javascript
const task = status.tasks?.find(t => t.id === taskId);
```

### 手順2: 単発生成のpreset_id送信（pv-dev #12）

**問題**: `src/screens/GenerateScreen.jsx` L1040-1047 の `api.generate()` 呼び出しに `preset_id` がない。キュー追加やCartesianには含まれている。

**修正**: L1040-1047を修正し、preset_idを追加:

```javascript
const result = await api.generate({
  prompt: pos,
  negative_prompt: neg,
  model, width: res.width, height: res.height, steps, scale, sampler,
  seed: seed !== '' ? parseInt(seed, 10) : null,
  folderSegments,
  filenameSegments,
  preset_id: selectedPresetId || null,
});
```

### 手順3: Cloud caption保存のcaptionConfig直接bind修正（foundation #14）

**問題**: `functions/api/prompt-vault/gallery/image/[hash]/caption.js` で `body.captionConfig` がオブジェクトのまま `.bind()` に渡される。D1のTEXTカラムにオブジェクトをbindすると `[object Object]` になるか部分失敗する。

**修正**:

```javascript
if (body.captionConfig !== undefined) {
  await env.DB.prepare(
    'UPDATE pv_images SET caption_config = ? WHERE hash = ?'
  ).bind(
    body.captionConfig != null ? JSON.stringify(body.captionConfig) : null,
    params.hash
  ).run();
}
```

### 手順4: Fran NovelAI疎通テストのホスト修正（pv-dev #14）

**問題**: `server.js` の `POST /debug/test-api` が `https://image.api.novelai.net/ai/generate-image` を使用。実生成は `https://image.novelai.net/ai/generate-image` を使用しており、Cloud側も後者。

**修正**: server.jsのtest-apiハンドラ内のURLを修正:

```javascript
const resp = await fetch('https://image.novelai.net/ai/generate-image', {
```

### 手順5: Cloud test-api成功応答のmessage追加（foundation #21）

**問題**: Cloud `handleDebugTestApi` の成功応答は `{ ok, status, statusText }` で `message` がない。UIは `r.message` を表示する。

**修正**: `src/worker/handlers/prompt-vault.js` の `handleDebugTestApi` 関数の成功応答にmessageを追加:

```javascript
return Response.json({
  ok, status: resp.status, statusText: resp.statusText,
  message: ok ? 'NovelAI API 疎通OK' : `ステータス ${resp.status}`,
});
```

---

## コミット指針

- ai-family-foundation: 1コミットにまとめる `fix(#14,#17,#19,#21): independent bug fixes from Phase 3 review`
- prompt-vault-dev: 1コミットにまとめる `fix(#12,#14): preset_id in generate, NovelAI test URL`
- 各リポジトリで push

## 禁止事項

- cards/presetsのschema変更（別案件の範囲）
- folder tree構造の変更（別案件の範囲）
- Cloud generateのデータライフサイクル変更（#18は別案件）
- debug/resetの変更（#16は別案件）

## テスト

- PG自己完結分:
  - prompt-vault-devの `npm run build` 成功
  - prompt-vault-devのinspect（既存2件以外に新規赤なし）
  - ai-family-foundationの `node scripts/inspect.mjs` 緑
- **実機系（発注者に依頼）**:
  - Cloud経由で単発生成し、生成結果が正しく返ること（#17）
  - Cloud経由で生成した画像がプリセット別一覧に表示されること（#12）
  - Pixel 10の設定画面でNovelAI疎通テストが正しい結果を返すこと（#14-pv, #21）

## 完了条件

- 6件の修正が両リポジトリでコミット・push済み
- 各リポジトリのinspect合格
- _STATUS.md更新不要（prompt-vault-devのバージョンは変わらない）

## 報告基準

報告は prompt-vault-dev の docs/reports/ に置く。

1. 実装内容の要約（手順1〜5の結果）
2. 完了条件の充足状況
3. inspect結果
4. 未完了・未検証の項目
5. サーバー再起動・コミット・プッシュの実施状況
6. Workerのデプロイが必要な場合はその旨（foundation側の変更はWorkerに反映が必要）
