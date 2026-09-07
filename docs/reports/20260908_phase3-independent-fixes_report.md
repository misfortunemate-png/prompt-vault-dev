# Phase 3独立バグ修正 完了報告（foundation #14,#17,#19,#21 / pv-dev #12,#14）

作成日: 2026-09-08 ／ PG: Claude Sonnet 4.6

---

## 1. 実装内容の要約

### 手順1: Cloud単発generateのtask identity修正（foundation #17 / #19）

**修正A — PvQueue.js `/add` handler**

`ids` 配列を追加し、ループ内で生成した各 UUID を収集。ループ後に `COUNT(*)` でキュー全件数を取得し、`{ success, added, total, ids }` を返すように変更。これにより #19（total 欠落）も同時修正。

**修正B — generate.js ポーリング**

`addData.ids?.[0]` で `taskId` を取得。`taskId` がない場合は 500 で即時 return。ポーリング中の task 特定を `status.tasks?.[status.tasks.length - 1]` から `status.tasks?.find(t => t.id === taskId)` に変更。busy queue 時でも自 task の結果のみを追跡する。

コミット: foundation `94a2831`

### 手順2: 単発生成の preset_id 送信（pv-dev #12）

`GenerateScreen.jsx` L1040 の `api.generate()` 呼び出しに `preset_id: selectedPresetId || null` を追加。キュー追加・Cartesian 計算には既に含まれており、単発のみ欠落していた。

コミット: pv-dev `e3db524`

### 手順3: Cloud caption保存の captionConfig bind 修正（foundation #14）

`caption.js` の `body.captionConfig` をそのまま `.bind()` に渡していた箇所を、`body.captionConfig != null ? JSON.stringify(body.captionConfig) : null` に変更。D1 の TEXT カラムに正しく JSON 文字列が格納される。

コミット: foundation `94a2831`

### 手順4: Fran NovelAI疎通テストURL修正（pv-dev #14）

`server.js` の `POST /debug/test-api` の fetch URL を `https://image.api.novelai.net/ai/generate-image` → `https://image.novelai.net/ai/generate-image` に修正。Cloud 側（prompt-vault.js）は既に正しいホストを使用していた。

コミット: pv-dev `e3db524`

### 手順5: Cloud test-api成功応答の message 追加（foundation #21）

`prompt-vault.js` の `handleDebugTestApi` 成功応答に `message: ok ? 'NovelAI API 疎通OK' : \`ステータス ${resp.status}\`` を追加。UI の `r.message` 表示が機能するようになる。

コミット: foundation `94a2831`

---

## 2. 完了条件の充足状況

| 条件 | 状態 |
|---|---|
| 6件の修正が両リポジトリでコミット・push済み | ✅ |
| pv-dev `npm run build` 成功 | ✅（inspect 内ビルド確認） |
| pv-dev inspect: 既存2件以外に新規赤なし | ✅ |
| foundation `node scripts/inspect.mjs` 緑 | ✅ 全項目 pass |

---

## 3. inspect 結果

### prompt-vault-dev

```
❌ マニフェスト照合: FAILED  ← 既存（別案件）
❌ 支給物SHA-256照合: FAILED ← 既存（別案件）
✅ 版確認
✅ _STATUS.md 行数
✅ danbooru-filtered.csv SHA-256
✅ ビルド確認
```
新規の赤: **0件**

### ai-family-foundation

```
=== 静的検査: ✅ 緑 (all pass) ===
```
全項目 pass

---

## 4. 未完了・未検証の項目（発注者テスト）

- Cloud 経由で単発生成し、生成結果が正しく返ること（#17）
- Cloud 経由で生成した画像がプリセット別一覧に表示されること（#12）
- Pixel 10 の設定画面で NovelAI 疎通テストが正しい結果を返すこと（#14-pv, #21）

---

## 5. サーバー再起動・コミット・プッシュの実施状況

| 項目 | 状態 |
|---|---|
| foundation コミット・push | ✅ `94a2831` |
| pv-dev コミット・push | ✅ `e3db524` |
| サーバー再起動 | 不要（ローカル未起動） |

---

## 6. Worker デプロイについて

foundation 側に以下の変更が含まれており、**Worker への反映が必要**です:

- `src/worker/do/PvQueue.js` — DO の add handler 変更（#17, #19）
- `src/worker/handlers/prompt-vault.js` — handleDebugTestApi の message 追加（#21）
- `functions/api/prompt-vault/generate.js` — taskId ポーリング変更（#17）
- `functions/api/prompt-vault/gallery/image/[hash]/caption.js` — captionConfig JSON化（#14）

`wrangler deploy` を実行してください（PG は実行権限を持たないため発注者に依頼）。
