# prompt-vault 生成直後の画像表示 修正指示書（prompt-vault v4.0.1 ／ foundation v0.25.5）
文書種別: 権威文書

作成日: 2026-09-26 ／ PM ／ 対応仕様: 本書（簡略フロー・process.md §2.2） ／ 対応要件定義: prompt-vault-dev#81 の要求 R-1〜R-4（発注者 2026-09-26） ／ 関連Issue: pv#81 ／ foundation#18 ／ foundation#55 ／ 本書一枚で完結（追補なし）

## 背景（PG調査の要約）

- foundation 4e54314（2026-09-12・foundation#18「生成結果は明示的な保存のときだけ D1 に登録」）以降、保存前の生成結果は `pv_images` に無い
- 画面側（GenerateScreen.jsx）は生成直後の表示にも `/gallery/image/<hash>/data`（`pv_images` を引く）を使っている → 404 → 表示されない
- 保存前の画像そのものは R2 に置かれており、所在は PvQueue DO のタスク `result.r2_key` が持つ。未保存の結果は DO が持ち主（24時間の掃除・`/clear`）

## 要求（発注者 2026-09-26・pv#81 コメントより転記）

- R-1 生成直後の画像を閲覧できる
- R-2 タブ切替・メニュー（設定など）の開閉・ホーム画面に戻ってからの復帰をしても、生成結果は消えずに残る。**ただし Android が OS 都合でアプリを破棄した場合は消えてよい**
- R-3 タスクキル（アプリを終了）すると消えてよい
- R-4 保存しない画像はアルバムの新着に行かない（foundation#18 維持）

## 添付マニフェスト（着工前照合・必須）

以下がすべて存在すること。**1つでも欠けたら着工せず docs/reports/ に報告。**

| # | パス／参照 | 種別 | SHA-256 |
|---|---|---|---|
| 1 | prompt-vault-dev: docs/instructions/instructions-pv-081-unsaved-result-view.md（本書） | 指示書 | — |
| 2 | prompt-vault-dev#81 の PM コメント3件（issuecomment-5835360922 ／ 5835415206 ／ 5835429761） | 要求・判断の記録 | — |

支給物なし。

## PG運用規律（定型・全フェーズ共通）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**: PM支給物はdiffゼロで検収される。技術的整合の調整もPMへ差し戻す
3. **発注者指示による仕様外修正**: 発注者から直接指示を受けた修正は実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記する。権威文書は書き換えない
4. **着工前**: 両リポジトリで `git pull` → inspect実行（マニフェスト照合・版確認）。緑でなければ着工しない。着工確認はチャット定型②で発話する
5. **稼働設定の変更三手順**: 稼働中の共有インフラ設定（ポート・serve/funnel等）に触れる場合は、状態記録→スクリプト一本で変更→差分確認の順とする。アドホックなコマンド連打での変異は禁止（#018）

## 作業範囲

- 何を: 保存前の生成結果を**タスク id で**取り出す経路を Worker に足し、画面の生成直後表示をその経路に切り替える。あわせて、生成結果の一覧が不要に消える条件とサムネ作成の時機を直す
- なぜ: 要求 R-1〜R-4。直し方 (a) は pv#81 で PM 判断（(b) はキュー経路に効かない・(c) は foundation#18 の巻き戻し）
- どこで: ai-family-foundation（Worker・DO）／ prompt-vault-dev（フロント）。chat-web のコードには触れない

## 仕様（PM確定事項）

### S-1 新経路 `GET /api/prompt-vault/queue/task/:id/data`（foundation）

- Worker 関数 `functions/api/prompt-vault/queue/task/[id]/data.js` を新設し、DO に `GET /task/:id/data` を足す
- DO はタスクを引き、`status = 'done'` かつ `result.r2_key` がある場合に R2 の実体を**暗号化されたまま** `application/octet-stream` で返す（`gallery/image/[hash]/data.js` と同じ形。復号は従来どおり画面側）
- タスクが無い（24時間の掃除・`/clear` 済み・存在しない id）→ 404。done 以外 → 409。R2 に実体が無い → 404
- 保存済み（`saved = 1`）のタスクも、タスクが残っている間は同じく返してよい
- **`pv_images` を読まない・書かない**。foundation#18 の「保存するまで gallery に出さない」を保つ
- family-auth の入口照合の内側に置く（入口の仕組みはそのまま。経路を足すだけで照合対象になることを確認する）

### S-2 画面の生成直後表示の切り替え（prompt-vault-dev）

- GenerateScreen.jsx の3か所（QueueTaskRow・キュー完了→results 追加・単発生成）で、クラウド経路の画像取得を `/gallery/image/<hash>/data` から `/queue/task/<task_id>/data` に替える
- 404 のときは画面を壊さず、該当カードに「期限切れ」と出す（トースト連発はしない）

### S-3 生成結果一覧の保持（prompt-vault-dev）

- 一覧は**現状どおりメモリ上（App.jsx の `results`）で持つ**。localStorage・sessionStorage・IndexedDB には保存しない（R-3。OS 破棄で消えるのは R-2 の但し書きで許容）
- App.jsx L162-164 の「`connectionState.revision` が変わったら `setResults([])`」を見直す。**PM の設計裁量**として次のとおり定める
  - 一覧は、作られたときの接続先（`route` が `cloud` か `fran` か＋`token`）を覚えておく
  - `offline` を挟んで同じ接続先に戻っただけなら消さない（ホーム画面からの復帰時の疎通再判定で `cloud → offline → cloud` となる場合を含む）
  - 別の接続先（`cloud ↔ fran`）に切り替わった、または `token` が変わったときは、現状どおり消す
- `connection.js` の revision の意味（pv#49 の柵）は変えない。進行中の非同期処理を revision で捨てる仕組みもそのまま

### S-4 サムネ作成の時機（両リポジトリ）

- 画面：保存前のサムネ作成・アップロード（GenerateScreen.jsx L504・L1079 の `generateAndUploadThumb`）をやめ、**保存が成功した後**に行う（ResultCard の `handleSave`・QueueTaskRow の保存の両方）。画像の元データは、手元の blob から取るか新経路から取り直す（PG 裁量）
- Worker：`functions/api/prompt-vault/thumbs/[hash].js` の PUT は、`pv_images` に行が無ければ **R2 に書く前に** 404 を返す（宙吊りのサムネを作らない）

## 影響範囲（PM調査済み——「ここが全部だ」）

検索キーワード: `gallery/image/` ／ `/data` ／ `generateAndUploadThumb` ／ `setResults(` ／ `revision` ／ `queue/task` ／ `thumbs/` ／ `pv_images`

**ai-family-foundation**

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/worker/do/PvQueue.js | `fetch()` のルート群（L238〜L386）に `GET /task/:id/data` を追加 | 要修正 |
| functions/api/prompt-vault/queue/task/[id]/data.js | 新設（`save.js` と同じ DO 呼び出し形） | 新設 |
| src/worker/handlers/prompt-vault.js | L209〜L221 付近：`/queue/task/:id/data` のルート追加（`/save`・`/:id` と衝突しない順で） | 要修正 |
| functions/api/prompt-vault/thumbs/[hash].js | PUT：行の有無を先に確かめ、無ければ R2 に書かず 404 | 要修正 |
| functions/api/prompt-vault/gallery/image/[hash]/data.js | 保存済み画像の経路 | 対象外（変更しない） |
| src/worker/do/PvQueue.js | `/task/:id/save`・24時間掃除（alarm 冒頭）・`/clear` | 確認のみ（変更しない） |
| functions/api/prompt-vault/generate.js | 単発生成の応答（`image`＋`task_id`） | 確認のみ |
| tests/issues/_pvqueue-fixture.mjs | DO の模擬 | 確認のみ（verifier に必要なら拡張可） |
| 入口（family-auth の照合箇所） | 新経路が照合の内側にあること | 確認のみ（変更禁止） |

**prompt-vault-dev**

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/GenerateScreen.jsx | L81（QueueTaskRow の画像取得） | 要修正 |
| src/screens/GenerateScreen.jsx | L500〜L505（キュー完了→results 追加の画像取得・サムネ） | 要修正 |
| src/screens/GenerateScreen.jsx | L1066〜L1079（単発生成の画像取得・サムネ） | 要修正 |
| src/screens/GenerateScreen.jsx | L1094〜L1112（`handleSave`：保存後にサムネ） | 要修正 |
| src/screens/GenerateScreen.jsx | L1461〜L1463（QueueTaskRow の保存：保存後にサムネ） | 要修正 |
| src/App.jsx | L162〜L164（revision での全消去） | 要修正 |
| src/lib/api.js | 新経路のヘルパ追加 | 任意 |
| src/lib/thumbGen.js | サムネ生成 | 確認のみ |
| src/lib/connection.js | revision の意味 | 対象外（変更しない） |
| src/screens/AlbumScreen.jsx 他 | — | 対象外 |
| tests/issues/manifest.mjs | verifier 登録 | 要修正 |

（PGは表にない箇所を触る場合、停止条件1で報告する）

## 作業手順

1. 両リポジトリで `git pull` → inspect 緑を確認し、チャット定型②で着工を発話
2. **先に verifier を書き、現行コードで赤になることを記録する**（negative control。下の検証計画参照）
3. foundation：S-1・S-4（Worker 側）を実装 → verifier 緑
4. prompt-vault-dev：S-2・S-3・S-4（画面側）を実装 → verifier 緑・既存 verifier 全件 PASS
5. デプロイは **Worker → フロント** の順。Worker のデプロイ前に、chat-web 側で進行中のデプロイが無いことを確かめる（重なる場合は停止条件で報告）。デプロイ前後で `/api/chat-web/healthz` の SHA を記録する
6. フロントを pages.dev へ公開（既存手順どおり）
7. 報告書を書き、チャット定型③で完了を発話

## 禁止事項

- 保存前の生成結果を `pv_images` に登録すること（foundation#18 の巻き戻し）
- `/gallery/image/:hash/data` の挙動を変えること
- 生成結果の一覧を localStorage・sessionStorage・IndexedDB に保存すること
- `connection.js` の revision の意味を変えること（pv#49）
- family-auth の入口照合・トークンに触れること（R-020）
- 24時間の未保存掃除・`/clear` の挙動を変えること
- chat-web のコード（ChatSession 等）に触れること

## 検証計画（受入基準との対応・これが検収の正になる）

| AC | 要求 | 検証項目（手順） | 手段 | 証跡様式 | negative control |
|---|---|---|---|---|---|
| AC-1 | R-1 | 未保存の done タスクに `GET /queue/task/:id/data` → 200・R2 の実体と同じバイト列。`pv_images` への SELECT/INSERT が起きない | verifier（foundation `tests/issues/pv-081-unsaved-result-data.mjs`・key `pv#81`） | verifier 出力 | 有（現行コードでは経路が無く 404 → 赤） |
| AC-2 | R-1 | 画面の3か所がクラウド経路で `/queue/task/<task_id>/data` を使い、`/gallery/image/<hash>/data` を生成直後表示に使っていない | verifier（prompt-vault-dev `tests/issues/pv-081-result-fetch-by-task.mjs`） | verifier 出力 | 有（現行コードで赤） |
| AC-3 | R-1 | クラウド経由でキュー生成・単発生成をし、生成直後に結果エリアとキュー一覧に画像が出る | 発注者実機 | — | 該当なし |
| AC-4 | R-2 | 生成後、アルバム→生成・テンプレート→生成のタブ往復、設定の開閉、ホーム画面に戻って復帰（OS 破棄が起きなかった場合）の各操作で、生成結果と画像が残る | 発注者実機 | — | 該当なし |
| AC-5 | R-2 | 接続が `cloud → offline → cloud`（同じ token）と遷移しても一覧が消えない。`cloud ↔ fran` の切替、token の変更では消える | verifier（prompt-vault-dev・AC-2 と同じファイルでよい） | verifier 出力 | 有（現行 App.jsx で `offline` を挟むと消える → 赤） |
| AC-6 | R-3 | 生成後にタスクキル→起動で、結果エリアは空（キュー一覧の表示は従来どおりでよい） | 発注者実機 | — | 該当なし |
| AC-7 | R-4 | 未保存の生成で `pv_images` の件数が増えない。保存すると新着に出る | verifier（AC-1 のファイル）＋発注者実機（新着に出ない・保存後は出る） | verifier 出力 | 該当なし |
| AC-8 | — | 掃除済み・存在しない id → 404、done 以外 → 409。画面は該当カードに「期限切れ」を出し、他のカードは表示される | verifier（両ファイル） | verifier 出力 | 該当なし |
| AC-9 | — | 保存前にサムネをアップロードしない。保存成功後にアップロードし、`thumb_ok = 1` になる。`pv_images` に行の無い hash への thumbs PUT は 404 で、R2 に書かれない | verifier（両ファイル） | verifier 出力 | 有（現行 thumbs PUT は行が無くても R2 に書く → 赤） |
| AC-10 | — | 新経路にトークン無しでアクセスすると 401（family-auth の内側） | PG 実行（デプロイ後の curl） | 生ログ | 該当なし |
| AC-11 | — | 回帰：両リポジトリの `verify:issues` 全件 PASS（pv#49 ほか既存含む）・inspect 緑・CI 緑 | PG 実行／CI | 出力・CI run URL | 該当なし |

- negative control は「現行コードで赤の記録 → 修正後に緑」の両方を証跡に残す
- **実機系（発注者に依頼）**: AC-3・AC-4・AC-6・AC-7（新着の目視）。Pixel 10。発注者のタイミングでまとめて実施するので、PG の完了はこれを待たない

## 完了条件

- S-1〜S-4 を実装し、Worker とフロントを公開済み
- 検証計画の PG 実行分をすべて実行し、証跡を完了報告に添付済み
- 実機系 AC は「発注者確認待ち」として報告書に列挙
- 版: prompt-vault-dev 4.0.1 ／ ai-family-foundation 0.25.5
- inspect緑・両リポジトリの _STATUS.md フロントマター更新・pull・push 実施済み

## 報告基準

報告は prompt-vault-dev の docs/reports/report-pv-081-unsaved-result-view.md に置く（AC対応表様式）。チャット発話は定型③または④のみ。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約
2. **AC対応表**: | AC | 検証項目 | 結果 | 証跡（生ログ引用 or reports/内パス） |
3. inspect結果（緑/赤と出力の添付）・CI run URL
4. 完了条件の各項に対する充足状況
5. 未完了・未検証の項目があれば列挙（#012・美化しない）
6. 発注者指示による仕様外修正があればその旨と内容
7. サーバー再起動・コミット・プッシュの実施状況
8. Worker デプロイ前後の healthz SHA、chat-web 側デプロイと重ならなかったことの確認

## 発令文（PMがpush後チャットへ転写する）

```
【発令】prompt-vault v4.0.1 — 生成直後の画像表示（保存前の結果をタスク id で取得）
作業: 保存前の生成結果を返す経路を Worker に足し、生成直後の表示・一覧保持・サムネ時機を直す
リポジトリ: prompt-vault-dev（指示書・報告）＋ ai-family-foundation（Worker） ／ Issue: pv#81
手順: 両リポジトリで git pull → prompt-vault-dev の docs/instructions/instructions-pv-081-unsaved-result-view.md を読む
      → マニフェスト照合・inspect緑を確認して着工
報告先: prompt-vault-dev の docs/reports/report-pv-081-unsaved-result-view.md（AC対応表様式）
```
