# pv#115 クラウド改修 — 報告（実装・モック検証・Fran 再起動は済み。実 Worker での確認と Pages 配信が未実施）

文書種別: 作業文書（PG報告）
作成: 2026-10-25 ／ PG ／ 対応指示書: docs/instructions/instructions-pv-115-cloud-sync.md（PM 裁定 S-1〜S-4 反映版 `c23add4`）／ 仕様: docs/prompt-vault-cloud-spec.md ／ Issue: pv#115（関連: foundation#276）

> 1 回目の停止報告（S-1〜S-4）は PM 裁定で解除された。その内容は git 履歴 `e80ab59` に残っている。本書は解除後の実装と検証の報告である。

## 状態

- 実装と、モックの Worker を使った検証（AC-1〜AC-17）は終わった
- **未検証**: AC-15 のうち「実 Worker で、有効なトークンなら 200・無効なトークンなら 401/403」の確認と、実クラウドへの送信。旧 pv-sync が使っていた `CLOUD_TOKEN` の候補はある（下の §5）。ただし、その有効性を読み取り専用の GET で確かめる操作は、PG 環境の権限判定（秘密の探索に当たる）で止められた。そのため実施していない。指示書の規定に従い、**この項目は完了扱いにしない**
- 着工: pull prompt-vault-dev `c23add4`／foundation `158c3b0`、マニフェスト照合 OK、inspect 緑

---

## 1. 実装内容の要約

| 区分 | ファイル | 内容 |
|---|---|---|
| 新設 | `server/sync.js` | 同期モジュール。秘密の読み込み（S-3）・暗号化（crypto.js と同じ形式）・フォルダ選択 API・同期の実行と進捗・WebP 送信成功の記録（S-4） |
| 変更 | `server.js` | `setupSyncRoutes(api)` を `/api` の 404 受けの直前に追加（import 1 行・呼び出し 1 行）。既存のエンドポイントは変えていない |
| 変更 | `.env.example` | `PV_VAULT_KEY=`・`CLOUD_TOKEN=`・`CLOUD_BASE=`・`PV_SYNC_SECRETS_PATH=` を空値で追加 |
| 新設 | `src/components/CloudSyncSection.jsx` | 設定画面「クラウド同期」。最上位フォルダのチェックと保存、同期ボタン、2.5 秒ごとの状態取得、進捗バー、結果の要約、トースト |
| 変更 | `src/screens/SettingsScreen.jsx` | `connectionState.route === 'fran'` のときだけ上のセクションを出す（import 1 行・表示 2 行） |
| 新設 | `src/lib/cloudImageLoad.js` | B-1・B-2 の取得の段取り（`loadViewerImage`・`loadPreviewImage`）と、復号した本体の形式判定（`sniffImageType`。WebP と PNG の混在に対応） |
| 新設 | `src/lib/blobUrls.js` | B-3。Blob URL の持ち主（`createBlobUrlSlot`・`createBlobUrlSetTracker`） |
| 変更 | `src/components/ImageViewer.jsx` | B-1。`loadViewerImage` を使い、サムネが 404 でも本体に進む。どの道筋でも `setImgLoading(false)`。本体の MIME は中身から判定 |
| 変更 | `src/screens/AlbumScreen.jsx` | B-2: PreviewThumb はサムネがないとき本体で代わりに出し、`generateAndUploadThumb` でサムネを作り直す。B-3: モジュール全体で持っていた `thumbCache`（解放しない Blob URL）をやめ、各枠が外れるときに解放する |
| 変更 | `src/screens/GenerateScreen.jsx` | B-3。生成結果が持つ Blob URL を、一覧から外れたとき（上限での切り捨て・消去）と画面を外すときに解放する |
| 新設 | `tests/issues/pv-115-cloud-sync.mjs`（＋ manifest 登録） | verifier（41 項目）。Fran は fran-harness の写しで起動し、Worker は同じプロセス内のモックで受ける |
| 新設 | `scripts/verify-sync.bat` | 同期の検査を一発で回す |
| 変更 | `README.md`・`package.json`・`public/sw.js` | クラウド同期の節を追加、版 4.2.0（CACHE_NAME も同じ） |

### 同期の動き（server/sync.js）
1. `data/sync.json` の `folders`（最上位フォルダ名）から、SQLite で対象画像を列挙する。照合は `folder = ? OR substr(folder, 1, length(?) + 1) = ? || '/'` で、LIKE を使わない（`%`・`_` も文字として扱う）
2. `GET /sync/images`（500 件ずつ）で、クラウドにある hash と `deleted_at` を取る。続けて `GET /sync/r2-usage` を取り、settings のフラットキー `'sync.r2_limit_gb'`（なければ 5）と比べる。認証の失敗（401/403）・取得の失敗・形の違い・上限到達のいずれかなら、**何も送らずに** `lastRun.errors` に理由を残す（fail closed）
3. 送る対象は、クラウドにない hash と、クラウドにあっても `data/sync-webp-state.json` に送信成功の記録がない hash。`deleted_at` がある hash は送らない（復活させない）
4. sharp で WebP q80 原寸と、長辺 320px の WebP q80 サムネを作る（拡大はしない）。`[keyId長][vault:v1][IV12][本文+tag16]` で暗号化し、`PUT /sync/upload-image`（Bearer・`X-PV-Hash`・base64 JSON の `X-PV-Meta`・multipart `image`）→ `PUT /thumbs/{hash}` の順に送る
5. **両方とも成功した hash だけ**を記録する（10 件ごとと、終了・中断時に原子的に書く）。1 件の失敗では止めず、次回に送り直す。途中で 401/403 が返ったら、そこで止める
6. 秘密は同期を始めるたびに読む（process.env が優先。欠けた 3 キーだけを secrets.env から読む）。秘密を置いた後に Fran を再起動する必要はない

---

## 2. AC 対応表

証跡はすべて `docs/reports/pv-115/` にある。verifier の各行は `pv115-verifier.log`（41/41 PASS）の該当行。

| AC | 検証項目 | 結果 | 証跡 |
|---|---|---|---|
| AC-1 | GET /api/sync/folders がフォルダ一覧と画像数（子フォルダ込み）を返す | PASS（モック）／本番 Fran でも確認（§7） | `pv115-verifier.log`「AC-1 …」、`live-fran-after-restart.log` |
| AC-2 | PUT /api/sync/folders → 既存の PUT /api/settings（設定画面と同じ 3 キー）→ GET で選択が残る。存在しない名前は記録して保存しない | PASS。negative control: settings.json に置いた `sync` は既存の保存で消える（赤相当を記録） | `pv115-verifier.log`「AC-2 …」「AC-2/AC-17 negative control …」 |
| AC-3 | PV_VAULT_KEY がないと POST /api/sync/run が 503 | PASS（理由「vault鍵（PV_VAULT_KEY）が設定されていません」）。negative control: 鍵とトークンがあれば 200 で始まる（AC-4・AC-13 の各実行） | `pv115-verifier.log`「AC-3/AC-15 …」、本番 Fran でも 503（§7） |
| AC-4 | 同期中の POST /api/sync/run が 409 | PASS（最初の起動は 200、実行中の状態に progress あり） | 「AC-4 …」 |
| AC-5 | 選択なしで同期 → uploaded:0 で正常完了 | PASS | 「AC-5 …」 |
| AC-6 | サーバーで暗号化 → フロントの decrypt() → 元のバイト列と一致 | PASS（keyId `vault:v1`）。negative control: 別の鍵では復号に失敗 | 「AC-6 …」×2 |
| AC-7 | B-1: サムネが 404 でも読み込み中が解除される | PASS（サムネ 404 → 本体を表示、両方 404 でも解除）。negative control: 修正前の連鎖では解除されない。**NC 実行**: ImageViewer を修正前に戻すと FAIL | 「AC-7 …」×5、`nc1-prefix-front.log` |
| AC-8 | B-2: thumb_ok=0 のフォルダでもプレビューが出る | PASS（本体で代わりに出し、サムネを作り直す）。**NC 実行**: AlbumScreen を修正前に戻すと FAIL | 「AC-8 …」×2、`nc1-prefix-front.log` |
| AC-9 | B-3: 外したときに revokeObjectURL が呼ばれる | PASS（付けている間は解放 0 件＝negative control → 差し替えで旧 URL、外すときに現在の URL を解放。結果一覧は外れた URL を解放）。**NC 実行**: 3 画面を修正前に戻すと FAIL | 「AC-9 …」×3、`nc1-prefix-front.log` |
| AC-10 | npm run build が成功 | PASS | `ac10-build.log` |
| AC-11 | npm run inspect で新規の赤なし | PASS（ALL GREEN） | `ac11-inspect.log` |
| AC-12 | npm run verify:issues で既存の結果を維持（両リポジトリ） | prompt-vault-dev: 着工前 `issues=25 pass=458 fail=0 waived=4` → 後 `issues=26 pass=499 fail=0 waived=4`（pv#115 の 41 項目が増えた）。1 回目の全体実行で pv#115 AC-2 の既存 `PUT /api/settings` が 1 度だけ 500 を返した（§5-3）。foundation: §2.1 | `ac12-verify-pv-run2.log`（緑）、`ac12-verify-pv.log`（1 回目・1 件 FAIL）、`ac12-ac16-verify-foundation.log` |
| AC-13 | 既存のクラウド hash が WebP に上書きされ、復号すると WebP | PASS（旧 PNG の a1 → フロントの decrypt() で WebP・原寸 64×48、サムネも WebP、メタデータは Worker の契約どおり、PNG は送らない）。negative control: 旧来の差分ルールでは a1 は対象外。**NC 実行**: 対象ルールを旧来の差分に戻すと AC-13・AC-14 が FAIL | 「AC-13 …」×5、`nc2-old-diff-rule.log` |
| AC-14 | 再同期での skip・失敗の再送・後から選んだフォルダの上書き | PASS（2 回目は PUT 0 件で skip 2。サムネ PUT 500 の失敗注入 → failed 1 で記録なし → 次回 uploaded 1。後から選んだ B の旧 PNG も WebP に上書き。記録はあるのにクラウドから消えた hash は再送） | 「AC-14 …」×3、「S-4 …」 |
| AC-15 | 秘密なしで通常起動・同期は 503・有効な認証で 200・無効な認証で送信を止める | **一部未検証**。モック: 秘密なしで起動、503、鍵だけでトークンなしなら 503 で送信 0、無効トークン → 401 → 中断・PUT 0 件、有効トークン → 200 で進む、ログと状態に秘密の値なし — PASS。本番 Fran: 秘密なしで 4.2.0 が起動し 503（§7）。**実 Worker での 200／401 の確認は未実施**（§5-1） | 「AC-15 …」×7、`live-fran-after-restart.log` |
| AC-16 | foundation の既存 verifier と fixture を維持、旧ジョブは停止のまま | PASS（foundation の変更 0 件、pv-sync.mjs は残置、runner の pv-sync 参照 0 件、Fran は旧スクリプトを呼ばない） | `ac16-old-job.log`、`ac12-ac16-verify-foundation.log` |
| AC-17 | 既存の設定保存と再起動を挟んでも、同期の選択と WebP 送信記録が残る | PASS（再起動後に PUT /api/settings → 選択 A,B が残り、再同期の PUT 0 件・skip 3）。negative control は AC-2 と同じ（旧方式は消える） | 「AC-17 …」 |

### 2.1 foundation（AC-12・AC-16）
- 本件による foundation の変更はない（コミットなし・作業ツリーの追跡ファイルにも本件の差分なし）。`scripts/pv-sync.mjs`（39,988 B）・verifier 16 本・fixture 2 本・`scripts/lib` は無変更。runner（ai-family-ops `924bf50`）の pv-sync 参照は 0 件（`ac16-old-job.log`）
- HEAD `158c3b0` の GitHub Actions は Issue Verifier・CI とも success（https://github.com/misfortunemate-png/ai-family-foundation/actions/runs/39104668837 ・ `ac12-ac16-verify-foundation.log`）。本件は foundation を変えていないので、この結果がそのまま維持されている
- **ローカルでの全件実行は完走しなかった**: foundation の作業ツリーには別作業の未コミット変更（`tests/issues/manifest.mjs` の変更・新しい verifier `chat-web-links-devseat.mjs` など 13 件）が載っている。この状態で `npm run verify:issues` を走らせると、CPU 0.8 秒・子プロセスなしのまま 20 分以上止まったので停止した（`ac12-ac16-verify-foundation-local-hung.log`）。別作業のファイルには触れない指示のため、それを外した状態での再実行はしていない。止まった原因が別作業の変更にあるのかどうかは確かめていない

### 2.2 仕様の追加検証 (A)〜(H) との対応
(A) AC-15 ／ (B) モックでは PASS、実 Worker は未検証 ／ (C) AC-13 ／ (D) AC-14 の 2 回目 ／ (E) AC-14 の失敗注入 ／ (F) AC-14 の B ／ (G)「S-4 hash deleted in the cloud …」 ／ (H) AC-16

---

## 3. inspect・CI
- inspect: 緑（`ac11-inspect.log`）
- CI: 該当なし（このリポジトリの CI は手動の verifier。push 後の run は §7 に記す）

## 4. 完了条件の充足

| 完了条件 | 状況 |
|---|---|
| server/sync.js の新設と、鍵の読み込み・暗号化・同期の流れ | 満たす（モックで検証） |
| 同期 API 4 本 | 満たす |
| crypto.js の decrypt() で復号できる | 満たす（AC-6・AC-13） |
| 設定画面のフォルダ選択と同期ボタン（Fran 接続時のみ） | 満たす。表示条件はコードで確認。**画面の目視は未実施**（§5-2） |
| B-1・B-2・B-3 | 満たす（段取りのテスト、配線の静的検査、修正前に戻した NC 実行） |
| pv-sync.mjs は物理削除せず、foundation の verifier を維持 | 満たす |
| 検証計画の全項目と証跡 | AC-15 の実 Worker 部分のみ未実施 |
| 操作スクリプト・再起動・pull・push | §7 |
| inspect 緑・_STATUS.md 更新 | 満たす |

## 5. 未完了・未検証

1. **実 Worker での認証確認と実送信（AC-15 の一部・仕様 §8.3）**: 秘密がまだ置かれていない（`D:\AI\secrets\secrets.env` に `PV_VAULT_KEY`・`CLOUD_TOKEN` がない）
   - 旧 pv-sync の `.env` に当たるファイル（`chat-pwa/.env`。`FRAN_BASE`・`PV_VAULT_ROOT`・`CLOUD_TOKEN`・`PV_VAULT_KEY` のキーがある）と、`D:\AI\secrets\pv-cloud-connection.json`（`auth_token`・`vault_key_base64`）に候補がある。キー名だけを見た
   - これを使う読み取り専用の GET は、PG 環境の権限判定で止められた。値は読んでいないし、回り道もしていない
   - 必要なのは、インフラPG（または発注者）が有効なトークンと鍵を secrets.env に置くこと。置いた後は、設定画面で小さなフォルダを選んで「同期」を押せば実送信の確認になる。トークンが無効なら 401 で送信せずに止まる
2. 設定画面「クラウド同期」の目視・実機確認（指示書の実機系）。前提となる **Pages へのフロント配信が未実施**（§7。PG 環境の権限判定で止められた）
3. 1 回目の全体実行で、既存の `PUT /api/settings` が 1 度だけ 500 を返した（`ac12-verify-pv.log`）。pv#115 を単独で 4 回、全体を 1 回走らせ直すといずれも緑だった。harness の Fran で `PUT /api/settings` を 300 回叩いても再現しなかった。同期のコードは settings.json を書かない（読むだけ）。既存の `atomicWriteJson`（rename）が Windows で一時的に失敗したものと推定するが、原因は確定していない。次に起きたときに原因が分かるよう、verifier の失敗詳細に `UNHANDLED` のログを載せるようにした
4. 1 回の同期の途中で R2 上限を超えることは止めていない。開始時の判定だけで、仕様 §3.7（旧 pvImageUp を踏襲）どおり
5. Worker は、ファイル名やフォルダ名に `..` を含むものを 400 で拒否する（`validatePathSegment`）。該当する画像はその 1 件だけが失敗として残る
6. 同期は 1 件ずつ順に送る。3,744 枚を全部選ぶと時間がかかる（1 件あたり変換と 2 回の送信）

## 6. 発注者指示による仕様外修正
なし。

## 7. 再起動・コミット・プッシュ・Worker
- コミット: `71b9717`（実装）→ push 済み（`c23add4..71b9717`）。報告書と証跡は別のコミット
- **Fran の再起動: 実施**（`live-fran-restart.log`）。再起動前は 4.1.0・`030a9f2`・pid 18548・生成キューは idle（空を確かめてから止めた）。停止 → `node --env-file=.env server.js` を起動 → healthz `4.2.0`・`71b9717`（localhost と tailnet `:8445` の両方）
- 本番 Fran での読み取り確認（`live-fran-after-restart.log`）:
  - `GET /api/sync/folders`: 最上位 8 フォルダ・合計 3,744 枚（インデックスと一致）
  - `POST /api/sync/run`: 503（vault 鍵・トークンが未配置。送信なし）
  - `data/sync.json`・`data/sync-webp-state.json` は未作成（本番の選択は空のまま）
- **フロント（Cloudflare Pages）の配信: 未実施**。README の手順（`npm run build` → `wrangler pages deploy … --branch=main`）を実行しようとしたが、PG 環境の権限判定で止められた。本番の pages.dev はまだ 4.1.0 のフロントで、設定画面の「クラウド同期」と B-1〜B-3 の修正は Pixel 実機にまだ届いていない。localhost から開いた画面は既存の CORS の許可先（pages.dev のみ）に当たらず Fran の API を呼べないので、画面の目視もできていない
- Worker: 変更・デプロイ不要（§8）

### 7.1 運用上の気づき（PM 判断材料）
本番の最上位フォルダは 8 つで、**3,744 枚のうち 3,679 枚が「旧」の下**にある（`旧/OC`・`旧/アズレン` など）。D-5（最上位フォルダ単位）のままだと、「旧」を選べばほぼ全件（変換後およそ 360MB）、選ばなければほぼ何も同期されない。子フォルダ単位で選べるようにするかどうかは、要件（D-5）の見直しに当たるので、PG は変えていない

## 8. Worker のデプロイ要否とエンドポイント（Part 4-2）
- 画像本体: `PUT /api/prompt-vault/sync/upload-image`（`src/worker/handlers/prompt-vault-sync.js:58` `handleUploadImage`。旧 pvImageUp の送り先 `pv-sync.mjs:333` と同じ）。サムネ: `PUT /api/prompt-vault/thumbs/{hash}`（`functions/api/prompt-vault/thumbs/[hash].js`）
- Worker は暗号文を中身を見ずに R2 へ置き、D1 を `ON CONFLICT(hash)` で更新する。WebP に変わっても影響はない。**Worker の変更・デプロイは不要**
- 注意点: 本体だけを送ると、その時点で D1 は `thumb_ok=0`・`thumb_r2_key=NULL` になる（excluded で上書き）。その直後のサムネ PUT で `thumb_ok=1` に戻る。サムネの送信に失敗した hash は、次回の同期で本体から送り直す
