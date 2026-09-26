# pv#81 生成直後の画像表示 — 完了報告（prompt-vault v4.0.1 ／ foundation v0.25.5）
文書種別: 作業文書

作成日: 2026-09-26 ／ PG ／ 対応指示書: docs/instructions/instructions-pv-081-unsaved-result-view.md ／ Issue: pv#81 ／ PM 裁定: pv#81 issuecomment-5842144262（対策Y）

経緯: いったん停止（S-3 と pv#49 verifier の字面検査が両立しない）→ PM 裁定で対策Y を採用 → 再開・完了。停止時の報告は本ファイルの前の版（PR #88・484fd95）にある。

## 1. 実装内容の要約

**ai-family-foundation（767f277・PR #237）**
- S-1: `GET /api/prompt-vault/queue/task/:id/data` を新設（`functions/api/prompt-vault/queue/task/[id]/data.js`）。DO `PvQueue` に `GET /task/:id/data` を追加。done かつ `result.r2_key` があれば、R2 の実体を暗号化されたまま `application/octet-stream` で返す。タスクが無い→404、done 以外→409、R2 に無い→404。`pv_images` は読まない・書かない。handler には `/save`・`/:id` の手前に配線した。family-auth の内側にある（`src/worker/index.js` の `handleRequest` は入口照合を通った要求だけを受け、`/api/prompt-vault/*` を `handlePromptVault` に流す）
- S-4（Worker）: `thumbs/[hash].js` の PUT は、まず `pv_images` の行を確かめ、無ければ R2 に書く前に 404 を返す
- 版 0.25.5（package.json・`handlers/healthz.js`）

**prompt-vault-dev（aca3099・PR #89）**
- S-2: `fetchTaskImage(conn, taskId)` を足し、QueueTaskRow・キュー完了→results 追加・単発生成の3か所で使う。`/gallery/image/` は GenerateScreen から消えた。404 のときは該当カード（ResultCard と QueueTaskRow）に「期限切れ」と出し、トーストは出さない
- S-3: App.jsx の revision による全消去をやめた。`resolveResultsOwner` が一覧の持ち主（route＋token）を覚え、offline は持ち主を変えない。`cloud ↔ fran` の切替や token の変更では消える。一覧はメモリ上の `results` のままで、どこにも保存しない。`connection.js` は変更していない
- S-4（画面）: 保存前の `generateAndUploadThumb` を削除した。サムネは `uploadThumbAfterSave` で、`handleSave` の保存成功後と、QueueTaskRow の `queueTaskSave` 成功後に作る。元データは手元の blob URL から取る（PG 裁量）
- pv#49 verifier の当該1件を挙動検査に差し替えた（**PM 裁定（issuecomment-5842144262）により差し替え**。§6 に差分）
- 版 4.0.1

## 2. AC対応表

| AC | 検証項目 | 結果 | 証跡 |
|---|---|---|---|
| AC-1 | 未保存 done タスクの `/queue/task/:id/data` が 200 で、R2 と同じバイト列を返す。`pv_images` に触れない | ✅ PASS（negative control 赤→緑） | foundation `tests/issues/pv-081-unsaved-result-data.mjs`：赤 `status=404 … route missing` → 緑 `status=200 type=application/octet-stream same=true` ／ `pv_images accesses=[] route=true` |
| AC-2 | 画面の3か所がタスク id の経路を使い、`/gallery/image/` を使わない | ✅ PASS（赤→緑） | prompt-vault-dev `tests/issues/pv-081-result-fetch-by-task.mjs`：赤 `/gallery/image/ occurrences=3`・`fetchTaskImage call sites=0` → 緑 PASS ×4 |
| AC-3 | 実機：生成直後に結果エリアとキュー一覧に画像が出る | ⏳ 発注者確認待ち | — |
| AC-4 | 実機：タブ往復・設定の開閉・ホームからの復帰で結果が残る | ⏳ 発注者確認待ち | — |
| AC-5 | `cloud→offline→cloud`（同じ token）で消えない。`cloud↔fran`・token の変更で消える | ✅ PASS（赤→緑） | 赤 `resolveResultsOwner missing`・`revision-keyed setResults([]) still present` → 緑 `blip=[["cloud/A",false],["offline/A",false],["cloud/A",false]] cloud→fran=true fran→cloud=true token A→B=true token B→(offline)→C=true` |
| AC-6 | 実機：タスクキル→起動で結果エリアが空 | ⏳ 発注者確認待ち | 実装上、一覧はメモリのみ（S-3 の検査 `results are not persisted to web storage` PASS） |
| AC-7 | 未保存では `pv_images` が増えない／保存すると新着に出る | ✅ verifier PASS ／ ⏳ 新着の目視は発注者確認待ち | `AC-7: pv_images count unchanged by unsaved fetch — size=0` |
| AC-8 | 無い id→404、done 以外→409、R2 に無い→404。画面は「期限切れ」を出す | ✅ PASS | foundation：赤 `non-done task → 409 — status=404` → 緑 404/409/404。画面：`helper maps 404 to expired`・`render 期限切れ` PASS。本番 curl（トークンあり・存在しない id）：`{"error":"Not Found"} HTTP 404` |
| AC-9 | 保存前にサムネを上げない。保存後に上げて `thumb_ok=1`。行の無い hash の PUT は 404 で R2 に書かれない | ✅ PASS（赤→緑） | foundation：赤 `status=200 r2_puts=["prompt-vault/thumbs/no-row.enc"]` → 緑 `status=404 r2_puts=[]` ／ 保存済みの hash → `status=200 … thumb_ok:1`。画面：赤 `total calls=2 inHelper=false` → 緑（呼び出しは保存後の関数だけ）。本番 curl：`PUT /thumbs/pv81-nonexistent-hash` → `{"error":"Not found"} HTTP 404` |
| AC-10 | 新経路にトークン無し→401 | ✅ PASS | デプロイ後 curl：`GET /api/prompt-vault/queue/task/no-such-id/data`（トークン無し）→ `HTTP 401` |
| AC-11 | 両リポジトリの `verify:issues` 全件 PASS・inspect 緑・CI 緑 | ✅ PASS（CI の既存の赤1件は §5） | foundation `SUMMARY issues=155 gated=80 pass=870 fail=0 gated_fail=0 not_run=6 waived=3` ／ prompt-vault-dev `SUMMARY issues=17 gated=17 pass=89 fail=0 gated_fail=0 not_run=0 waived=4` ／ inspect と CI は §3 |

## 3. inspect 結果・CI

**prompt-vault-dev（デプロイ後・ローカルサーバー再起動後）**
```
✅ マニフェスト照合
✅ 支給物SHA-256照合
✅ 版確認
✅ _STATUS.md 行数
✅ danbooru-filtered.csv SHA-256
✅ ビルド確認
=== ALL GREEN ===
```
デプロイ直後は `healthz version: 4.0.0 ❌ Version mismatch` だった。inspect が見ているのは `localhost:8789/api/healthz`（fran 経路のローカル Express）で、pages.dev ではない。発注者の許可を得て、このサーバー（PID 16864）を同じコマンド `node --env-file=.env server.js` で起動し直した（新 PID 18184・healthz 4.0.1）。その後の結果が上の緑。

**ai-family-foundation**: `✅ version 一致: 0.25.5` ／ `=== 静的検査: ✅ 緑 ===` ／ `最終判定: ⚠️ PASS with 1 NOT_RUN`（動的検査の NOT_RUN は従来から。EVIDENCE_TARGET 未設定）

**CI**
- foundation PR #237：source-gate・verify-issues（ubuntu・windows）PASS。main push：https://github.com/misfortunemate-png/ai-family-foundation/actions/runs/36210112095（success）
- prompt-vault-dev PR #89：source-gate・verify-issues PASS。main push の Issue Verifier 系：https://github.com/misfortunemate-png/prompt-vault-dev/actions/runs/36210234048（success）

## 4. 完了条件の充足

| 条件 | 状態 |
|---|---|
| S-1〜S-4 実装、Worker とフロントを公開 | ✅ Worker：`wrangler deploy` Version ID `3034edbe-bd02-411d-8202-b2c04f8baeda` ／ フロント：`wrangler pages deploy dist --project-name=prompt-vault` → https://e2bcb9e5.prompt-vault-6gr.pages.dev |
| 検証計画の PG 実行分をすべて実行し、証跡を添付 | ✅ §2 |
| 実機系 AC を「発注者確認待ち」として列挙 | ✅ §5 |
| 版 prompt-vault-dev 4.0.1 ／ foundation 0.25.5 | ✅ |
| inspect 緑・両リポジトリの _STATUS.md フロントマター更新・pull・push | ✅ |

## 5. 未完了・未検証

- **実機（発注者・Pixel 10）**: AC-3・AC-4・AC-6・AC-7（新着の目視）。PG は実機で確認していない
- **保存後にサムネが実際に作られること（ブラウザでの OffscreenCanvas 経路）**: verifier は呼び出しの位置を静的に確かめているだけ。本番で `thumb_ok=1` になるかは、実機での保存（AC-7）と合わせて確認してほしい
- **CI の `deploy-pages`（GitHub Pages）が main push で failure**: run 36210234031。このジョブは #71・#75・#79・#83 の main push でも毎回 failure で、本件とは関係ない既存の問題。本件では触れていない
- **foundation の Workers Builds（Cloudflare 側の PR チェック）が failure**: PR #234〜#236 でも同じく failure。必須チェックではない
- **chat-web の healthz の `version` が 0.25.4 のまま**: `src/worker/chat-web/healthz.js` に版が直書きされている。chat-web のコードには触れない規定なので変えていない。`deployed_sha` は新しいもの（§8）。`/healthz`（handlers）は 0.25.5 を返す
- 既存の `.phase6b-*` 一時ディレクトリが prompt-vault-dev に残っている（既存の verifier が作ったもの。本件では触れていない）

## 6. 発注者指示・PM 裁定による仕様外の変更

- **PM 裁定（issuecomment-5842144262）により、pv#49 の検査1件を差し替えた。** 変えたのは `tests/issues/pv-049-connection-revision.mjs` の L99-103 だけで、他の検査は一字も変えていない

旧:
```js
checks.push(check(
  'Generate result invalidation consumes the common connection revision',
  /setResults\(\[\]\)[\s\S]{0,120}\[connectionState\.revision\]/.test(app),
  'Generate results are not invalidated by connection revision',
));
```
新（要約）: App.jsx から `resolveResultsOwner` を切り出して pv#49 の中で実行する（pv#81 の verifier には依存しない）。確かめるのは次のとおり。cloud→offline→cloud（同じ token）では消えない／cloud→fran で消える／fran→cloud で消える／token の変更で消える。加えて、effect が `resolveResultsOwner(resultsOwnerRef.current, connectionState)` → `if (clear) setResults([])` と配線され、依存が `[connectionState.route, connectionState.token]` であること。検査名は `Generate results are invalidated when backend identity (route+token) changes`

negative control（持ち主判定が常に「同じ」を返す変異。`if (owner === null || owner === key)` を `return { owner: key, clear: false }` にした）:
```
赤  FAIL  Generate results are invalidated when backend identity (route+token) changes — wired=true cloud→fran=false fran→cloud=false token change=false cloud→offline→cloud=[false,false]
    SUMMARY issues=1 gated=1 pass=9 fail=1
緑  PASS  Generate results are invalidated when backend identity (route+token) changes
    SUMMARY issues=1 gated=1 pass=10 fail=0
```
変異は検査の実行中だけ入れ、終わったらすぐ元に戻した（コミットには入っていない）。

- **発注者の指示により実施**: fran 経路のローカル Express サーバー（:8789）を起動し直した（§3。セッション外プロセスの停止は停止条件なので、事前に発注者の許可を得た）

## 7. 再起動・コミット・プッシュ

- コミット: foundation `767f277`（PR #237）／ prompt-vault-dev `aca3099`（PR #89）、停止報告 `484fd95`（PR #88）。どちらも main に取り込み済み。pull 済み
- 両リポジトリの main は保護されているので PR 経由で入れた
- PR #88 の squash には停止報告だけが入り、コードのコミットは入らなかった（ブランチへの push が届いていなかった）。そのため、コードは同じ内容を PR #89 として別に取り込んだ
- 再起動: prompt-vault ローカルサーバー（§3・§6）

## 8. Worker デプロイ前後の healthz SHA・chat-web との重なり

| 時点 | `/api/chat-web/healthz` |
|---|---|
| デプロイ前 | `"version":"0.25.4"` `"deployed_sha":"f172ec0e525802dc8b2b36386a3ac4099ac373f7"` |
| デプロイ後 | `"version":"0.25.4"`（§5 の直書き）`"deployed_sha":"767f2771522c8163c1425677ebc58d3a0696bab5"` |

- デプロイ前の確認: `wrangler deployments list` の最新は 2026-09-25T15:42:11Z で、GitHub Actions に実行中のランは無かった。chat-web 側のデプロイとは重なっていない
- build-info: `{"version":"0.25.5","sha":"767f277","branch":"main","dirty":false}`
