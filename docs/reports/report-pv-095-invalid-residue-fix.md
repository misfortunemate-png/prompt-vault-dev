# 完了報告 — prompt-vault v4.1.0 当たらない入力の観測化（pv#98〜pv#103）

- 文書種別: 作業文書（PG 完了報告・AC 対応表様式）
- 対応指示書: docs/instructions/instructions-pv-095-invalid-residue.md（改訂 #106・#108 を含む）
- 根拠: docs/reports/report-95-invalid-residue.md（調査回答・72 箇所）
- 作業ブランチ: `pv95-invalid-residue-fix` → [PR #109](https://github.com/misfortunemate-png/prompt-vault-dev/pull/109)
- 停止報告: report-pv-095-invalid-residue-stop.md（着工前・案 A）／ report-pv-095-invalid-residue-stop-pv100.md（pv#100 前・案 A＋A-1）
- 作成: 2026-10-03 PG

## 1. 実装内容の要約

### 集約先（J-1）

| 実行環境 | 集約先 | 形 | 上限・保存方式 |
|---|---|---|---|
| Fran | `logs/YYYY-MM-DD.log`（既存） | `{ts, level, code:'INVALID', message, kind, stage, raw, reason}`。定めた失敗の種別は `code:'NOVELAI_FAILED'` 等で同じ欄を持つ（`server/log.js` の `recordEvent`）。既存 7 種の code はそのまま | 日ごとのファイル。raw は 1000 字で切り、切ったことを残す（T-06 の削除前の中身だけは切らない） |
| フロント | `src/lib/invalidLog.js` | `{ts, lastTs, kind, stage, raw, reason, count}` | **localStorage `pv-invalid-log`**・**上限 200 件**（古いものから落とす）。同じ kind・stage・raw は count を数えて一つにまとめ、最新の位置へ移す。localStorage が使えないときはメモリに退避し、その旨も記録。保存値が壊れていたら空にせず、壊れた中身を 1 件として残す |

- 見る場所: 設定 →「デバッグ・接続」に「当たらなかった入力（この端末）」と「直近エラー（接続中の経路: … の /debug/errors）」を並べた。端末分は接続先に関係なく出る（offline でも見える。ブラウザで確認済み）
- `/debug/errors`: 解析できない行は捨てずに、その位置へ INVALID（S-20）として返す。返す件数は末尾 50 件（従来 20 件）
- `src/lib/errors.js`（未使用の `ErrorCode`・`createError`）は除去（AC-3）
- 秘密（J-3）: トークン・vault 鍵・`.env` の行は raw に入れず `[secret type=… length=…]` か行番号と長さだけ

### Issue ごとの要約

| Issue | commit | 内容 |
|---|---|---|
| pv#98 | `88be950` | 上記の集約先・S-17・S-20 |
| pv#99 | `edf75a2` | T-01 verify-issues の UNKNOWN 判定・集計・終了コード・未定義フラグの exit 64／T-02 inspect の版確認で「接続できない」と「応答の異常」を分ける／T-03 review-doctor の数値引数と PORT |
| pv#100 | `001c4e7` | S-10・S-11 の本文検査（`server/validate.js`）・S-12 のクエリ・S-13 の 0 行更新・T-06・F-12・§4.3 #6・#11・#12 |
| pv#101 | `18258f3` | S-03・S-04・S-19 の生成パラメータ検査（`server/genParams.js`・NovelAI を呼ばずに拒む）・S-18 のガード値・S-01・S-02・S-05 の種別・F-08・F-09・§4.3 #1・#2・#5・#7・#8 |
| pv#102 | `42182d7` | F-01〜F-07・F-10・F-11・S-14・S-15 |
| pv#103 | `fa0d7c4` | §4.3 の残り・S-06〜S-09・S-16・S-21・S-22・F-14〜F-18 |
| 版 | `479a023` | 4.1.0（package.json・sw.js の CACHE_NAME・README） |

### 既存 verifier との関係（書き換えていない）

既存 verifier は書き換えていない（禁止事項）。そのかわり、既存 verifier がソースを写して読む・行を目印にする作りに合わせて実装した。

| 既存 verifier | 前提 | 合わせ方 |
|---|---|---|
| pv#5・pv#9・pv#40 | `generate.js`・`db.js`・`png-meta.js`・`scanner.js` を一時ディレクトリへ写して読む | これらに新しい静的 import を足さない。生成パラメータの検査は呼び出し側（`/generate`・キュー）で行い、png-meta の残余は結果（`residue`）に載せ、scanner は動的 import で記録する |
| pv#53・pv#56 | `connection.js`・`api.js` を単独で写して読む／`const cloudHealthOk = await fetchReachable(...)` の行と `base = conn.cloudUrl;` の行を目印にする | 2 ファイルの記録は動的 import。目印の行は残した |
| pv#49 | App.jsx の結果の持ち主の効果の並び（160 字・40 字以内）を見る | F-18 の記録は別の効果にした |
| pv#44 | `fetch` を差し替えたまま戻さない | 新設のハーネスは読み込み時の `fetch` を保持して使う |

## 2. AC 対応表

| AC | 検証項目 | 結果 | 証跡 |
|---|---|---|---|
| AC-1 | Fran で残余（S-17）を起こすと logs/ に INVALID と kind・stage・raw・reason、/debug/errors で返る。解析できない行を捨てない（S-20） | 緑（赤: INVALID 0 件） | evidence-pv095/pv098-red.txt → pv098-green.txt |
| AC-2 | フロントの集約先に載る・再読み込み後も残る・上限で古いものから落ちる・同じものは count。設定のデバッグに offline でも端末分が出る。J-2: 接続先の切替で古い応答を捨てた（STALE_CONNECTION）・未接続で取得しない（OFFLINE）は残余にしない | 緑（赤: モジュールなし）。J-2 の check は公開後の本番確認で見つけて足した（§7）。offline 表示はローカルと本番のブラウザで確認 | pv098-green.txt・pv098-j2-red.txt → pv098-j2-green.txt |
| AC-3 | `ErrorCode`・`createError` の並立がない | 緑（errors.js 除去） | pv098-green.txt |
| AC-4 | T-01: ERROR・pass・undefined・配列でない戻り値が PASS にならず、`unknown=` に数えられ、exit≠0。T-02: 500・JSON でない・version なしは理由と元の字句つきで FAILED、接続できないだけ NOT_RUN（理由つき）。T-03: 当たらない引数は理由つきで exit 64 | 緑（赤: VERDICT PASS・exit 0） | pv099-red.txt → pv099-green.txt |
| AC-5 | S-10・S-11・S-12: 当たらない本文・クエリは 4xx、ファイル・DB はバイト単位で不変、INVALID | 緑（赤: 200 で保存・壊れた後は後続も 500） | pv100-red.txt → pv100-green.txt |
| AC-6 | 正の対照: 実物の settings／cards／presets、フロントが送る本文、Cloud 由来の本文（pv-sync handback の形）がすべて通る | 緑（実物・Cloud は NOT_RUN でなく実行） | pv100-green.txt（`AC-6 real Fran …`・`AC-6 Cloud-origin …`） |
| AC-7 | S-13 favorite・caption 404＋記録、meta は 200＋記録／F-12 壊れた鍵は保存しない・keyId 不一致を記録（鍵の値なし）／T-06 削除したカードの中身全体が logs/ に／§4.3 #6 解析できない result が一覧に「結果を読めない」で出る／#11・#12 失敗がトーストと集約先へ | 緑 | pv100-green.txt |
| AC-8 | S-03・S-04・S-19: 当たらない値で NovelAI（モック）が呼ばれずに 4xx・記録。未指定は既定値で 1 回だけ呼ばれる。正の対照（MODELS 6・SAMPLERS 3・RESOLUTIONS 3・seed -1・設定の既定モデル） | 緑（赤: モックが呼ばれる） | pv101-red.txt → pv101-green.txt |
| AC-9 | S-18: ガード値が文字列・max<min・負のときキューを開始せず、NovelAI を呼ばず、理由を応答（画面のトースト）と集約先に | 緑（赤: `intervalMin:"abc"` で 2 件とも間隔なしに実行） | pv101-green.txt |
| AC-10 | S-01・S-02・S-05: 401・402・429・503・418・HTML 本文・通信失敗が別種別、単発・キューの両方で記録、再試行なし（呼び出し 1 回）。test-api の 429 は rate-limit、401 は API_AUTH_FAILED のまま。F-08 いまの Worker の値は残余にならない。F-09・§4.3 #1・#2・#5・#7・#8 | 緑 | pv101-green.txt |
| AC-11 | F-01〜F-07・F-10・F-11 が J-11〜J-14 のとおり。Cloud /healthz 401・403 → auth-failed。未知の route の寄せ先が一つ | 緑（赤: healthz 401 で reason=null・route `satellite` がそのまま） | pv102-red.txt → pv102-green.txt |
| AC-12 | S-14: 未定義の /api/* が GET・POST・PUT・DELETE とも JSON の 404＋記録（dev 起動＝Vite あり）。S-15: 許可外 Origin を記録（応答は不変） | 緑（赤: GET で 200・index.html） | pv102-green.txt |
| AC-13 | pv#103 の事象欄の全 ID。S-06・S-16・S-22・F-18 は J-17 の裁定どおり | 緑 | pv103-red.txt → pv103-green.txt・pv#103 クローズコメント |
| AC-14 | 72 箇所の対応表 | 本書 §8 | 本書 |
| AC-15 | verify:issues 全件 PASS（既存 17 本含む 23 本）・inspect 緑・CI 緑・healthz の version 4.1.0 | 下記 §3・§7 | evidence-pv095/pv103-regression.txt・pv103-inspect.txt |

- 赤の件数が緑より少ない Issue（pv#98・#101・#103）は、赤のとき新設モジュールがなく複数の check が 1 件の FAIL にまとまったため
- 新設 verifier の判定式は、赤を取った後に 3 か所直した（pv#99 の T-02 で `package.json` の "JSON" に当たる甘い判定・raw の書き方、pv#101 の F-08 の段名の置き場所、pv#103 の S-17 を起動時に読まない settings.json で確かめる・存在しない VAULT_ROOT を一意のパスにする）。いずれも直した後の verifier で赤を取り直した

## 3. inspect・CI

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

- verify:issues 全件（J-2 修正後）: `SUMMARY issues=23 gated=23 pass=435 fail=0 gated_fail=0 not_run=0 waived=4 unknown=0`（waived は既存 pv#20・pv#23 の 4 件で、以前から同じ）— evidence-pv095/final-regression.txt・final-inspect.txt
- CI（PR #109 → main `534f64d` の push）: [CI](https://github.com/misfortunemate-png/prompt-vault-dev/actions/runs/37083420744) success・[Issue Verifier](https://github.com/misfortunemate-png/prompt-vault-dev/actions/runs/37083420750) success
- CI（J-2 修正と本報告の PR）: §7

## 4. 完了条件の充足状況

| 完了条件 | 状況 |
|---|---|
| pv#98〜pv#103 の修正を実装し、Fran 再起動・pages.dev 公開済み | 実装済み。再起動・公開は §7 |
| 検証計画の PG 実行分をすべて実行し、証跡を添付 | 済み（§2・evidence-pv095/） |
| pv#103 はクローズ済み。pv#98〜pv#102 は開いたまま | §7 |
| 版 4.1.0 | 済み（`479a023`） |
| inspect 緑・_STATUS.md 更新・pull・push | §7 |

## 5. 未完了・未検証の項目

- **実機系（発注者）**: 設定 →「デバッグ・接続」で当たらなかった入力の一覧が見えること（PC か Pixel 10）。PG はローカルのビルドを未接続の状態でブラウザ表示し、端末分の一覧と「取得できません: オフライン」が並ぶことだけ確かめた
- 画面の振り分けのうち JSX にあるもの（§4.3 #3・#4・#9・#11〜#20・#22〜#26・F-06・F-07・F-10・F-11・F-14〜F-17）は、verifier では静的な検査（段名の記録があり、黙る形が消えていること）で、実際に画面を動かした確認ではない。lib にあるもの（invalidLog・connection・api・crypto・queueResult・queueStatus・thumbDb）は振る舞いで確かめた
- S-07 のディレクトリ読込失敗は、Windows で権限を落とす試験を作らず、記録の配線（walkDir の catch）と、ファイル単位の失敗（S-08）の振る舞いで確かめた
- **本件の範囲外として残したもの**（調査回答書の 72 箇所に入っていない。直していない）:
  - GenerateScreen の `pv3-selected-cards`・`pv3-slot-random`・`pv3-slot-enabled`・`pv3-random-child-mode`・`pv3-selected-children` の復元・保存の `catch {}`、ImageViewer の caption_config・char_prompts の解析・設定取得・カード登録まわりの `catch`、AlbumScreen の `pv_thumbColMin`、App の表示設定の復元
  - `cards.json`・`presets.json` が壊れていると Fran が起動時に落ちる（起動時に読むため。記録は残る）。従来どおり
  - ai-family-foundation（Worker）側の `/api/prompt-vault/*` の残余（指示書で対象外）。Worker の `/debug/errors` はいまも空配列を返すスタブ

## 6. 発注者指示による仕様外修正

- **発注者の指示により実装（2026-10-03・検収後）**: 設定 →「デバッグ・接続」の「当たらなかった入力（この端末）」と「直近エラー（接続中の経路の /debug/errors）」に、それぞれ「コピー」ボタンを付けた（Pixel で手で写すのが手間なため）。一覧を新しい順に、kind・段・raw・理由（INVALID 以外は code・message・detail）と、見出し（コピーした時刻・接続中の経路・サーバの版・画面のホスト）付きの文字列にしてクリップボードへ書く（`formatEntriesForCopy`）。clipboard API の許可が得られない環境では選択してコピーする方式に切り替え、それも失敗したらトーストと集約先に残す。効果確認: verifier pv#98 に check 2 件（整形の中身・両欄のボタン）を追加して緑、ローカルのビルドをブラウザで開いて「…をコピーしました」が出ることを確認（内蔵ブラウザは clipboard API を拒否するため、切り替えた方式で通った）

次は PG の判断で行った（指示書の範囲内と判断したもの）。

- 公開リポジトリ（PUBLIC）のため、AC-6 の「実物の写し」と Cloud の写しはリポジトリに置かず、`data/`（.gitignore 済み）と `data/test-fixtures/pv100/` から verifier が実行時に読む。リポジトリには形だけ同じ合成 fixture（`tests/issues/fixtures/pv100/`）を置いた。CI などファイルがない環境では該当 check が NOT_RUN になる
- Cloud の写し（A-1）: 2026-10-02T23:57:11.835Z（UTC）に foundation `.env` の `FA_TOKEN_DEV` で GET `/api/prompt-vault/{settings,cards,presets}` のみ。settings は pv-sync と同じく Fran の `sync.*` キーを合わせる形（いまの Fran の settings.json には `sync.*` がない）。トークンの値は出力・fixture・報告に残していない。証跡と fixture にトークン・実カードの文字列が含まれないことを走査で確かめた（0 件）
- POST /presets は、フロントが送る `slotOrder`・`folder`・`filename`・`childCards` を黙って捨てていた（S-11 の残余）。検査を通ったものは保存するようにした
- 生成時の値域はフロントの入力欄に合わせた（width・height は 64〜2048 の 64 の倍数、steps 1〜50、scale 0〜10、seed は -1 か 0〜4294967295）。設定の PUT の steps・scale も同じ範囲にそろえた
- F-03: 当たらないタイムアウトの保存値は既定の 8000ms で確かめ、元の値を記録する（以前は NaN・0 のまま即打ち切り）
- S-09: J-17 の「書き込みに関わる箇所」に当たらないよう、保存の振る舞い・応答は変えず記録だけにした

## 7. サーバー再起動・コミット・プッシュ

- コミット（作業ブランチ）: §1 の 6 件＋版 `479a023`。[PR #109](https://github.com/misfortunemate-png/prompt-vault-dev/pull/109) を CI 緑の後に squash で main へ（`534f64d`）。main は保護されているので PR 経由
- **Fran 再起動（発注者の許可を得て実施）**: 状態記録 → 停止・起動・確認を一つのスクリプトで実行
  - 前: PID 24512 `node --env-file=.env server.js`（親プロセスなし）・:8789 LISTEN・healthz `{"version":"4.0.1","sha":"91118ff"}`
  - 再起動前に実物の `.env` がすべて当たることを確認（S-16）: `PORT` は整数・`VAULT_ROOT` は存在・`=` のない行なし（値は出していない）
  - 後: PID 14652 同じコマンド（作業ディレクトリ main `534f64d`）・:8789 LISTEN・healthz `{"status":"ok","version":"4.1.0","sha":"534f64d"}`。tailnet（`fraine.tail204746.ts.net:8445`）経由も同じ。未定義の `/api/no-such` は `404 application/json`
  - 起動時の INVALID は 0 件（danbooru CSV 39454 件で読み飛ばしなし）。その後 1 件、PG の確認用ブラウザ（`http://localhost:5199`）からの許可外 Origin が S-15 として記録された（集約先が働いている実例）
- **pages.dev 公開**（README の手順）: `npm run build` → `npx wrangler pages deploy dist --project-name=prompt-vault --branch=main`。本番 `https://prompt-vault-6gr.pages.dev` が `index-C19Ftheu.js`・`sw.js` の `CACHE_NAME = 'prompt-vault-v4.1.0'` を配信することを確認
- **公開後の本番確認で見つけたもの（J-2 の不足）と修正**: 本番の設定 →「デバッグ・接続」で、接続先の切替で古い応答を捨てた結果（StaleConnectionError）と、未接続で取得しない結果が残余として記録されていた。どちらもコードが定めて扱う結果（J-2）なので、`recordFailure` が `STALE_CONNECTION`・`OFFLINE`（未接続の例外に code を付けた）を記録しないようにし、api 経由の #5・#11・#12 も同じ扱いにした（#11・#12 のトーストは残す）。pv#98 の verifier に check を足して赤 → 緑を記録。フロントだけの修正なので Fran は再起動不要。PR #110 で main に入れ、pages.dev に再公開する（結果は pv#95 のコメントに記す）
- 内蔵ブラウザからは Fran（tailnet）に届かず未接続になった（`Failed to fetch`）。このため本番の画面での Fran 経路の確認はしていない。実機確認は発注者に依頼（§5）
- pv#103: J-17 によりクローズ（最終コメントに commit と赤→緑）。pv#98〜pv#102 は開いたまま（PM 検収）
- _STATUS.md: 更新済み（本報告と同じ PR）
- PR #97（CLAUDE.md「コードの規則」C-1・C-2）は未マージのまま（発注者のマージ待ち）

## 8. AC-14 対応表（72 箇所）

当たる枝＝コードが定めて扱う値（J-2）。記録は Fran なら logs/ の INVALID（他の code は明記）、フロントなら invalidLog。verifier の check 名は各 verifier の出力の行頭の名前（前方一致）。

### 8.1 サーバ（S-01〜S-22）

| ID | 当たる枝として定めた値 | 残余の扱い | 記録の kind・stage | verifier check |
|---|---|---|---|---|
| S-01 | 2xx。種別: 401/403→auth、402→payment、429→rate-limit、5xx→server-error、通信失敗→network | その他の status は INVALID。どれも例外で止める（再試行なし） | NOVELAI_FAILED `novelai-{auth,payment,rate-limit,server-error,network}`／INVALID `novelai-unexpected-status`・`S-01 novelai.generate（single 単発／queue キュー）` | pv#101 `AC-10 single status:*`・`AC-10 queue 429` |
| S-02 | ZIP の `.png` エントリ（store・deflate） | 例外。Content-Type・長さ・本文の先頭を raw に。PNG 以外のエントリは読み飛ばして記録 | `novelai-response-format`・`novelai-zip-non-png-entry`・`S-02 novelai.generate（…）` | pv#101 `AC-10 S-02` |
| S-03 | MODELS 6 種（5-full・5-curated・4-5-full・4-5-curated・4-full・3） | 呼ばずに 400 | `generate-params-invalid`・`S-03/S-04 POST /generate` | pv#101 `AC-8 S-03 unknown model` |
| S-04 | sampler 3 種・width/height 64〜2048 の 64 の倍数・steps 1〜50・scale 0〜10・seed -1/0〜2^32-1・prompt は文字列・本文のキー 12 種。未指定（undefined・null・空文字）は既定値 | 呼ばずに 400 | 同上／キュー実行時は `S-04 queue.runLoop` | pv#101 `AC-8 S-04 *`・`AC-8 unspecified *`・`AC-8 control *` |
| S-05 | test-api の 2xx。401/403 は既存の `API_AUTH_FAILED` | 他の種別は NOVELAI_FAILED、当たらない status は INVALID | `S-05 /debug/test-api` | pv#101 `AC-10 S-05 *` |
| S-06 | tEXt／非圧縮 iTXt の Description・Comment。他のキーワードは対象外として読み飛ばす（記録しない） | PNG でない・zTXt・圧縮 iTXt・Comment の JSON 破損・途中で切れたチャンクを `residue` に載せ記録 | `png-meta-unread`・`S-06 scanner.parsePngMeta`／`S-06 POST /save` | pv#103 `AC-13 S-06 *` |
| S-07 | 読めたディレクトリ・ファイル | incomplete（削除しない・従来どおり）＋記録。フロントは incomplete を warn トーストで出す | `scan-dir-unreadable`・`scan-file-failed`・`scan-failed`・`S-07 scanner.*` | pv#103 `AC-13 S-07 *`・既存 pv#40 |
| S-08 | サムネイル生成成功 → thumb_ok=1 | thumb_ok=0 のまま＋記録 | `thumbnail-failed`・`S-08 scanner.generateThumb` | pv#103 `AC-13 S-08` |
| S-09 | 0 以上の整数の seed・文字列の断片・空の断片は `その他`/`gen`（設計どおり） | 寄せる動作は変えず記録（seed なし→0000000000、文字列でない断片） | `save-name-folded`・`S-09 POST /save` | pv#103 `AC-13 S-09` |
| S-10 | `server/validate.js` の settings（3 節＋`sync.*`）・cards・presets の形 | 書き込まず 400 | `request-body-invalid`・`S-10 PUT /{settings,cards,presets}` | pv#100 `AC-5 S-10 *`・`AC-6 *` |
| S-11 | 個別経路の既知の欄と型・slotId の実在 | 書き込まず 400 | `request-body-invalid`・`S-11 …` | pv#100 `AC-5 S-11 *` |
| S-12 | days 0〜3650・limit 1〜1000（未指定は既定） | 400。sync-inventory は J-5 により従来の締め方で続行し記録 | `query-invalid`・`S-12 GET /gallery/*` | pv#100 `AC-5 S-12 *`・pv#103 `AC-13 S-12` |
| S-13 | 1 行以上の更新 | favorite・caption は 404、meta は 200 のまま記録 | `image-hash-not-found`・`sync-meta-nothing-to-update`・`S-13 …` | pv#100 `AC-7 S-13 *` |
| S-14 | api ルーターに定義した経路 | JSON の 404（全メソッド・Vite より先） | `api-route-undefined`・`S-14 /api fallback` | pv#102 `AC-12 S-14 *` |
| S-15 | ALLOWED_ORIGINS・`*.prompt-vault-6gr.pages.dev` | 応答は不変。Origin ごとに一度記録 | `cors-origin-rejected`・`S-15 CORS` | pv#102 `AC-12 S-15 *` |
| S-16 | `KEY=VALUE` 行・1〜65535 の整数の PORT・存在する VAULT_ROOT | PORT は起動を止め理由を出す。= のない行（行番号と長さだけ）と存在しない VAULT_ROOT は記録して続行 | `port-invalid`・`env-line-without-equals`・`vault-root-missing`・`vault-tmp-init-failed`・`S-16 …` | pv#103 `AC-13 S-16 *` |
| S-17 | JSON として解析できる data/*.json | 例外（応答 500 は従来どおり）の前に記録 | `data-file-unparseable`・`S-17 read*` | pv#98 `AC-1 *`・pv#103 `AC-13 S-17` |
| S-18 | ガード値: 設定なし・guard なし・各値なしは既定。intervalMin/Max 1〜3600・maxPerJob 1〜500・max≥min | 追加・開始を拒む（理由を応答に）。走行中なら中断 | `queue-guard-invalid`・`S-18 queue.{addTasks,startQueue,runLoop}` | pv#101 `AC-9 S-18 *` |
| S-19 | タスクの既知の欄 7 種と型・params の既知のキーと S-04 の値域 | 何も追加せず 400 | `queue-task-invalid`・`S-19 POST /queue/add` | pv#101 `AC-8 S-19 *` |
| S-20 | JSON のオブジェクトとして解析できるログ行 | その位置に INVALID として返す | `log-line-unparseable`・`S-20 /debug/errors line N` | pv#98 `AC-1 (S-20)`・pv#103 `AC-13 S-20` |
| S-21 | 3 列以上で先頭が空でない行・整数の件数 | 行は読み飛ばし件数は 0（従来どおり）、件数と例を記録 | `danbooru-csv-rows`・`S-21 loadDanbooruTags` | pv#103 `AC-13 S-21` |
| S-22 | 解析できる M2 presets.json・配列の欄 | 移行の振る舞いは変えず記録 | `m2-presets-unparseable`・`m2-presets-field-not-array`・`S-22 runMigration` | pv#103 `AC-13 S-22` |

### 8.2 フロント（F-01〜F-12・F-14〜F-18）

| ID | 当たる枝として定めた値 | 残余の扱い | 記録の kind・stage | verifier check |
|---|---|---|---|---|
| F-01 | JSON のオブジェクト・既知のキー・token は文字列・manual は真偽値・cloudOfflineReason は null/no-token/auth-failed/cloud-error | 未接続として扱う／該当の欄を既定にし記録（一度だけ・token は種別と長さ） | `connection-*`・`F-01 connection.*` | pv#102 `AC-11 F-01/F-02 *`・`AC-11 J-3 *` |
| F-02 | route は fran・cloud・offline | `normalizeState` 一か所で offline、元の値を記録・保存値も直す | `connection-route-unknown`・`F-02 connection.normalizeState` | pv#102 `AC-11 J-11 *` |
| F-03 | 500〜30000 の整数（未設定は 8000） | 保存しない／保存値が当たらなければ 8000 で確かめ記録。設定画面は未保存を表示 | `reachability-timeout-invalid`・`F-03 connection.*` | pv#102 `AC-11 F-03 *` |
| F-04 | Fran /healthz 2xx→fran。Cloud /healthz 2xx かつ /settings 2xx→cloud、401/403（healthz・settings とも）→auth-failed、他の status→cloud-error、通信失敗・タイムアウト→null | 失敗の理由（network・timeout・status）を記録 | `reachability-fran-failed`・`reachability-cloud-failed`・`F-04 connection.checkReachability` | pv#102 `AC-11 F-04 *`・既存 pv#53 |
| F-05 | 2xx かつ JSON。2xx 以外は既存の文言（status 付き） | 経路・path・status 付きの例外＋Content-Type・本文の先頭を記録。エラー本文が JSON でないことも記録 | `api-response-not-json`・`api-error-body-not-json`・`F-05 api.request` | pv#102 `AC-11 F-05 *` |
| F-06 | 2xx→復号、404→期限切れ（pv#81） | 記録して例外（呼び出し側が表示・記録） | `task-image-fetch-status`・`F-06 GenerateScreen.fetchTaskImage` | pv#102 `AC-11 F-06` |
| F-07 | success・error・info・warn・warning | info の見た目で型名付き表示＋記録 | `toast-type-unknown`・`F-07 Toast` | pv#102 `AC-11 F-07 *` |
| F-08 | status: pending・running・done・error・skipped／state: idle・running・paused | 元の値を表示し、一度だけ記録 | `queue-task-status-unknown`・`queue-state-unknown`・`F-08 …` | pv#101 `AC-10 F-08 *` |
| F-09 | cloud: `image.hash`（task_id で取得）／fran: `image.filename` | Fran の扱いに寄せず記録・トースト。task_id なしは期限切れ表示＋記録 | `generate-response-shape-unknown`・`F-09 GenerateScreen.handleGenerate` | pv#101 `AC-10 F-09` |
| F-10 | MODELS・SAMPLERS・RESOLUTIONS＋random、seed は空か整数 | 寄せずに「一覧にない値」として表示・記録。一覧にない解像度・整数でないシードでは生成・追加しない | `generate-option-unlisted`・`generate-seed-invalid`・`last-prompt-unparseable`・`F-10 GenerateScreen.*` | pv#102 `AC-11 F-10 *` |
| F-11 | 設定画面の MODEL_OPTIONS 4 種（変えない・J-14） | 保存値のまま「一覧にない値」と表示・記録 | `settings-model-unlisted`・`F-11 SettingsScreen.load` | pv#102 `AC-11 F-11` |
| F-12 | base64 で 32 バイトの鍵・`{id, raw}` の記録・暗号文の keyId＝手元の id | 保存しない（鍵の値は記録しない）。記録の破損・形違い・keyId 不一致・短い暗号文を記録（keyId 不一致でも復号は試みる） | `vault-key-*`・`ciphertext-malformed`・`F-12 crypto.*` | pv#100 `AC-7 F-12 *` |
| F-14 | タブ generate・album・template | 「未実装のタブです」（従来）＋記録 | `tab-unknown`・`F-14 App.activeTab` | pv#103 `AC-13 F-14` |
| F-15 | カード: slots・cards（スロットあり）・edit／プリセット: list・edit | 一覧の最上位へ（従来）＋一度だけ記録 | `template-nav-unknown`・`F-15 Template*List` | pv#103 `AC-13 F-15 *` |
| F-16 | 同一オリジンの /assets・/api、メッセージ `CLEAR_CACHE` | 未知のメッセージは送り手へ返し、クライアントが記録 | `sw-message-unknown`・`F-16 sw.message` | pv#103 `AC-13 F-16 *` |
| F-17 | 直積モード fixed・expand | fixed として扱い（従来）記録 | `cartesian-mode-unknown`・`F-17 GenerateScreen.buildCartesianTasks` | pv#103 `AC-13 F-17` |
| F-18 | fran・cloud は持ち主を更新、offline は意図どおり変えない（J-17） | 他の経路は offline と同じ扱いで記録（`unknownRoute`） | `results-owner-route-unknown`・`F-18 App.resolveResultsOwner` | pv#103 `AC-13 F-18 *`・既存 pv#81・pv#49 |

### 8.3 失敗を握りつぶしていた箇所（§4.3 #1〜#27）

トーストは J-4 のとおり利用者の操作（保存・お気に入り・セリフ・鍵インポート・生成）の失敗だけ。他は記録だけ。

| # | 扱い | 記録の kind・stage | verifier check |
|---|---|---|---|
| 1 | キュー行の画像取得・復号の失敗を記録 | `queue-task-image-fetch-failed`・`§4.3 #1 GenerateScreen.QueueTaskRow` | pv#101 `AC-10 §4.3 #1`・`AC-10 #1/#7/#8` |
| 2 | 解析できない result を行ごとに一度記録 | `queue-task-result-unparseable`・`§4.3 #2 …` | pv#101 `AC-10 §4.3 #2`・`AC-10 #2` |
| 3 | タブ復帰時のプリセット再取得の失敗を記録 | `presets-refetch-failed`・`§4.3 #3 …` | pv#103 `AC-13 §4.3 #3` |
| 4 | Cloud 初回読込の失敗をすべて記録（トーストは認証エラーのみ・従来） | `cloud-initial-load-failed`・`§4.3 #4 …` | pv#103 `AC-13 §4.3 #4` |
| 5 | キューのポーリングの失敗を記録 | `queue-poll-failed`・`§4.3 #5 …` | pv#101 `AC-10 §4.3 #5`・`AC-10 #5` |
| 6 | 解析できない result を「結果を読めない」項目で一覧に出す・記録 | `queue-task-result-unparseable`・`§4.3 #6 queueResult.parseTaskResult` | pv#100 `AC-7 #6 *` |
| 7 | 完了タスクの画像取得の失敗を記録 | `queue-result-image-fetch-failed`・`§4.3 #7 …` | pv#101 `AC-10 §4.3 #7` |
| 8 | 単発生成の画像取得の失敗を記録＋トースト | `generate-image-fetch-failed`・`§4.3 #8 …` | pv#101 `AC-10 §4.3 #8` |
| 9 | 保存後のサムネイル作成・アップロードの失敗を記録 | `thumb-upload-failed`・`§4.3 #9 …` | pv#103 `AC-13 §4.3 #9` |
| 10 | サムネイル PUT の状態を見て、2xx 以外は記録・例外（作り直せるよう印を外す） | `thumb-put-status`・`§4.3 #10 thumbGen…` | pv#103 `AC-13 §4.3 #10` |
| 11 | お気に入りの保存失敗を記録＋トースト | `favorite-save-failed`・`§4.3 #11 …` | pv#100 `AC-7 #11 favorite` |
| 12 | セリフの保存失敗を記録＋トースト | `caption-save-failed`・`§4.3 #12 …` | pv#100 `AC-7 #12 caption` |
| 13 | ビューアの画像取得の 2xx 以外・例外を記録 | `viewer-image-fetch-status`・`viewer-image-load-failed`・`§4.3 #13 …` | pv#103 `AC-13 §4.3 #13` |
| 14 | 画像詳細の取得の失敗を記録 | `viewer-detail-failed`・`§4.3 #14 …` | pv#103 `AC-13 §4.3 #14` |
| 15 | サムネイル取得（再試行後）・復号の失敗を記録 | `album-thumb-failed`・`§4.3 #15 …` | pv#103 `AC-13 §4.3 #15` |
| 16 | IndexedDB 保存・サムネイル作成の失敗を記録 | `thumb-cache-save-failed`・`thumb-upload-failed`・`§4.3 #16 …` | pv#103 `AC-13 §4.3 #16` |
| 17 | フォルダのプレビューの 2xx 以外・例外を記録 | `folder-preview-*`・`§4.3 #17 …` | pv#103 `AC-13 §4.3 #17` |
| 18 | 黙るのは「400 かつ VAULT_ROOT未設定」だけ。他は記録＋トースト | `gallery-root-load-failed`・`§4.3 #18 …` | pv#103 `AC-13 §4.3 #18` |
| 19 | リスキャン状態のポーリングの失敗を記録 | `rescan-poll-failed`・`§4.3 #19 …` | pv#103 `AC-13 §4.3 #19` |
| 20 | テンプレートのサムネイル取得の失敗を記録 | `template-thumb-failed`・`§4.3 #20 …` | pv#103 `AC-13 §4.3 #20 *` |
| 21 | getThumb の失敗を null に寄せる前に記録 | `thumb-fetch-failed`・`§4.3 #21 api.getThumb` | pv#103 `AC-13 §4.3 #21` |
| 22 | ギャラリー取得の失敗を 0 件に寄せる前に記録 | `template-gallery-failed`・`§4.3 #22 …` | pv#103 `AC-13 §4.3 #22 *` |
| 23 | タグ候補の取得の失敗を記録 | `tag-suggest-failed`・`§4.3 #23 …` | pv#103 `AC-13 §4.3 #23` |
| 24 | 結果保持件数の取得の失敗を記録（5 件のまま） | `settings-load-failed`・`§4.3 #24 …` | pv#103 `AC-13 §4.3 #24` |
| 25 | 到達確認の reject を記録 | `reachability-rejected`・`§4.3 #25 …` | pv#103 `AC-13 §4.3 #25` |
| 26 | システム情報・版・直近エラーの取得失敗を記録（版は「取得できません」を表示） | `system-info-failed`・`version-fetch-failed`・`debug-errors-fetch-failed`・`§4.3 #26 …` | pv#103 `AC-13 §4.3 #26` |
| 27 | IndexedDB の読み書き・消去の失敗を記録 | `thumb-cache-failed`・`thumb-cache-delete-failed`・`§4.3 #27 thumbDb.*` | pv#103 `AC-13 §4.3 #27` |

### 8.4 スクリプト（T-01〜T-06）

| ID | 当たる枝として定めた値 | 残余の扱い | 出し方（J-15: Fran のログには書かない。T-06 だけはデータを消す道具なので logs/） | verifier check |
|---|---|---|---|---|
| T-01 | status: PASS・FAIL・NOT_RUN・WAIVED／フラグ: --json・--strict-all・--strict-not-run | UNKNOWN（判定・`unknown=` 集計・exit 1）、元の値と理由を出力。未定義フラグは exit 64 | 標準出力 | pv#99 `T-01 *` |
| T-02 | healthz 2xx・JSON・文字列の version | 接続できない（curl exit 7）は NOT_RUN＋理由、他は FAILED＋理由・元の字句 | 標準出力 | pv#99 `T-02 *` |
| T-03 | --port 1〜65535・--timeout-ms 1〜600000 の整数、PORT（環境変数・.env）も同じ | exit 64＋元の字句と理由 | 標準エラー | pv#99 `T-03 *` |
| T-04 | （残余の型あり・確認のみ）--json・--help、他は exit 64 | 変更なし | — | — |
| T-05 | （残余の型あり・確認のみ）COMPATIBLE・REPAIR_REQUIRED・UNKNOWN（exit 3） | 変更なし | — | — |
| T-06 | 実在するスロットの slotId（削除の判定は変えない・J-7） | 削除する前に中身全体を記録 | `orphan-card-deleted`・`T-06 normalize-cards`（logs/・raw を切らない） | pv#100 `AC-7 T-06 *` |

## 9. J-5 で確かめた呼び出し元と応答の扱い

呼び出し元: フロント（`src/`）・`scripts/`（review-doctor は data/ を直接読むだけで API を呼ばない）・ai-family-foundation `scripts/pv-sync.mjs`（`818f6e4`・読み取りのみ）。ai-family-ops は Fran API を呼ばない（runner から pv-sync は撤去済み）。

| 経路 | フロント以外の呼び出し元 | 応答 |
|---|---|---|
| PUT /settings・/cards・/presets | pv-sync handback（pv-sync.mjs:519・529・543） | **変えた**（当たらなければ 400）。J-6 の例外（#108）。pv-sync は 2xx 以外で例外にして止まる。Cloud 由来の本文が通ることを AC-6 で確かめた |
| PUT /gallery/image/:hash/favorite・caption | pv-sync handback（:664・:677） | **変えた**（0 行更新は 404）。pv-sync は 2xx 以外を errors に数えて次へ進む（:668-684） |
| PUT /gallery/image/:hash/meta | pv-sync（:691） | 変えない（記録だけ） |
| GET /gallery/sync-inventory | pv-sync（:225・:590） | 変えない（当たらない offset・limit は記録だけ） |
| GET /settings・/cards・/presets・/gallery/image/:hash・/images/full/:hash・/thumbs/:hash.webp・/healthz、POST /rescan、GET /rescan/status | pv-sync | 変えない（S-17 の 500 も従来どおり） |
| POST /cards/slot ほか個別の書き込み・GET /gallery/{recent,favorites,search,by-preset,by-card}・POST /generate・/queue/*・/debug/*・/save | フロントのみ | 当たらない入力は 4xx（/save は S-09 で変えない） |
| 未定義の /api/* | なし | 200（index.html）→ JSON 404 |
