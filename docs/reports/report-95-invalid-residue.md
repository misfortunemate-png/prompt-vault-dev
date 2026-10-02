# 調査回答書 — どれにも当たらない入力が観測されずに落ちる箇所（pv#95）

- 文書種別: 作業文書（PG 調査回答）
- 依頼: [pv#95 コメント](https://github.com/misfortunemate-png/prompt-vault-dev/issues/95#issuecomment-5952009015)
- 対象: prompt-vault-dev main `91118ff`（2026-10-02 時点の HEAD）
- 範囲: 読み取りのみ。コード・データ・本番は変更していない
- 作成: 2026-10-02 PG

## 1. 結論

- **該当箇所: 72**。内訳は、振り分けの主表 45 件（サーバ 22・フロント 17・スクリプト 6）と、フロントで失敗を握りつぶす箇所 27 件（§4.3）
- **観測されない箇所（観測先なし）: 50**（主表 23 ＋ 握りつぶし 27）
- 一過性の表示か console にしか出ない、または一部の経路でしか残らない、または種別を取り違えて残る: 19
- 当たらないことが残る: 3。うち Fran の集約先（`logs/`）に残るのは S-17（設定・カード・プリセットの JSON が解析できない）の 1 件だけ。T-04・T-05 は手動で回す診断ツールのその場の出力
- 当たらない入力を与える試験は pv#53（Cloud `/settings` の 401、両方とも通信できない場合）・pv#40（走査の読込失敗）・pv#81（404→期限切れ）の 3 件だけ。どれも当たらない枝の一部しか通っていない

判定の区分（「観測先」欄の先頭の記号）:

| 記号 | 意味 |
|---|---|
| ○ | 集約先（`logs/YYYY-MM-DD.log`）に、種別・元の字句・理由のどれかが残る |
| △ | 一過性の表示（トースト・画面の記号）か console にしか出ない。または一部の経路でしか残らない。または種別を取り違えて残る |
| × | どこにも出ない |

## 2. 集約先の現状（前提）

- **Fran（サーバ）**: `writeLog()`（[server.js:127](../../server.js)）が `logs/YYYY-MM-DD.log` に `{ts, level, code, message, detail}` を追記する。使われている code は `DANBOORU_LOAD`・`GENERATE_FAILED`・`SAVE_FAILED`・`API_AUTH_FAILED`・`API_NETWORK`・`FS_WRITE_FAILED`・`UNHANDLED` の 7 種だけ。画面では「設定 → デバッグ」で当日分の末尾 20 件が見える（[server.js:808](../../server.js)）。scanner・queue・png-meta・ギャラリー系の 500 応答は `writeLog` を通らない
- **フロント**: 集約先はない。トースト（一過性・最大 3 件・`error` 型だけ `console.error`）だけがある。[src/lib/errors.js](../../src/lib/errors.js) の `ErrorCode`・`createError` は、どこからも import されていない（grep で 0 件）
- **Worker（ai-family-foundation）**: 対象外。ただしフロントが受け取る状態値との突き合わせのため、`src/worker/do/PvQueue.js`（foundation `32a0aa4`）が出す値だけを確かめた（F-08）

## 3. サーバ側（server.js・server/）

| ID | 箇所 | 振り分けの対象 | 当たる枝 | 当たらないときの扱い | 観測先（残るもの） | 試験 |
|---|---|---|---|---|---|---|
| S-01 | [server/providers/novelai.js:99](../../server/providers/novelai.js) | NovelAI 応答の HTTP 状態 | `resp.ok`（2xx） | 例外。2xx 以外は 401・402・429・5xx などを区別せず、すべて `NovelAI API <status>: <本文先頭300字>` という一つの例外になる。`ErrorCode.API_RATE_LIMITED` は定義だけで使われていない | △ 単発生成は `GENERATE_FAILED`（[server.js:696](../../server.js)）として残る（status と本文＝元の字句あり。種別なし）。キュー実行は `task.error` に入るだけ（[queue.js:120](../../server/queue.js)）。メモリにしかなく、ログに残らず、再起動・クリアで消える | なし |
| S-02 | [novelai.js:12-48](../../server/providers/novelai.js), [:104](../../server/providers/novelai.js) | 2xx 応答の本文形式 | ZIP（`PK\x03\x04`）の中の `.png` エントリ。圧縮方式は 0（store）か 8（deflate） | 例外。圧縮方式がそれ以外なら `未対応の圧縮方式: n`。ZIP でない本文（PNG 直送・JSON など）や PNG を含まない ZIP は、まとめて `ZIPレスポンス内にPNGが見つかりません` になる。Content-Type は見ていない。PNG 以外のエントリは黙って読み飛ばす | △ 経路ごとの残り方は S-01 と同じ。残るのは理由だけで、Content-Type・本文の先頭（元の字句）は残らない | なし |
| S-03 | [novelai.js:55-56](../../server/providers/novelai.js), [:77](../../server/providers/novelai.js) | `model` による要求形式の振り分け | `nai-diffusion-3` → v3 形式。それ以外 → v4 形式 | 近い型に寄せる。未知のモデル名も v4 形式（`v4_prompt` 付き）で送る。`isV5` は計算するだけで使われていない | × NovelAI が受け付ければ何も出ない。拒否されたら S-01 として出る | なし |
| S-04 | [server/generate.js:15-27](../../server/generate.js) | 生成パラメータ | 真値ならそのまま使う | 既定に寄せる、または素通り。0・空・`undefined` は `\|\|` で既定値（832/1216/28/5/k_euler_ancestral）に置き換わる。seed が負なら乱数。数値でない文字列や未知の sampler は検査されず NovelAI へ送られる | × | なし |
| S-05 | [server.js:819-830](../../server.js) | `/debug/test-api` の NovelAI 応答 | `resp.ok` → 疎通 OK。fetch 例外 → `API_NETWORK` | 近い型に寄せる。2xx 以外は、429・5xx・400 も含めてすべて `API_AUTH_FAILED` として記録する | △ ログには残る（status は message に、本文は detail に）。ただし種別を取り違える | なし |
| S-06 | [server/png-meta.js:57-88](../../server/png-meta.js), [:4-5](../../server/png-meta.js), [:35](../../server/png-meta.js) | PNG テキストチャンクのキーワード・形式 | `tEXt`/`iTXt`（非圧縮）の `Description`・`Comment` | 黙って捨てる。それ以外のキーワード、`zTXt`、圧縮 `iTXt` は読み飛ばす。`Comment` の JSON 解析に失敗しても `catch {}` で何もしない。PNG でない入力は全項目 null を返す | × メタデータが null のまま索引に登録される | なし |
| S-07 | [server/scanner.js:31-36](../../server/scanner.js), [:147-150](../../server/scanner.js) | 走査中のディレクトリ読込・ファイル処理の失敗 | 読めたものだけ処理する | 記録する（console のみ）。失敗すると `incomplete=true` になり、ファイル単位の失敗は `console.warn` に出る | △ console に出る。`/rescan/status` の `incomplete` はフロントで一切読まれない（`src/` を grep して 0 件） | pv#40（走査に失敗しても行を消さないこと） |
| S-08 | [scanner.js:57-59](../../server/scanner.js), [generate.js:98](../../server/generate.js) | サムネイル生成の失敗 | 成功 → `thumb_ok=1` | 記録する（console のみ）。`thumb_ok` は 0 のまま | △ console | なし |
| S-09 | [generate.js:37-43](../../server/generate.js) | 保存先の名前に使う断片・seed | 真値で `（なし）` でない断片 | 既定に寄せる。断片が空なら `その他`/`gen` に、seed が null なら `0000000000` になる。配列でない入力は TypeError → `SAVE_FAILED` | × 寄せた場合は何も残らない（例外になった場合だけ ○） | pv#5・pv#20（どちらもこの残余は扱わない） |
| S-10 | [server.js:283-286](../../server.js), [:304-311](../../server.js), [:438-444](../../server.js) | `PUT /settings`・`PUT /cards`・`PUT /presets` の本文 | （検査なし） | 素通り。本文がそのままファイルに置き換わる。未知のキー・欠けたキー・型違いをすべて保存する。読む側も `DEFAULT_SETTINGS` と合わせない（キーが欠けていると、設定画面のガード節が消えて保存ボタンが押せなくなる） | × 事後に手動で `scripts/review-doctor.mjs`・`orphan-cards-report.mjs` を回せば分かる | pv#8（`updated_at` のみ） |
| S-11 | [server.js:340](../../server.js), [:381-392](../../server.js), [:450](../../server.js) | 個別 PUT（slot/card/preset）の本文 | `name` の必須と重複、`parentId` の実在 | 素通り。`...req.body` で未知のフィールドもそのまま合流する。カードの移動先 `slotId` が実在するかは確かめない（孤児カードができうる） | × | pv#8 |
| S-12 | [server.js:528-529](../../server.js), [:580](../../server.js), [:599](../../server.js), [:606](../../server.js), [:634](../../server.js) | クエリの `days`/`limit` | `parseInt` の結果が真値 | 既定に寄せる、または素通り。`NaN`・0 は既定値になる。負の値はそのまま SQLite の `LIMIT` に渡り、制限なしになる（`sync-inventory` だけは [:587-588](../../server.js) で範囲を締めている） | × | なし |
| S-13 | [server.js:569-576](../../server.js), [:612-628](../../server.js), [server/db.js:152-195](../../server/db.js) | お気に入り・セリフ・同期メタの更新先 hash と値 | `favorite` が 0/1、`caption` が文字列（違えば 400 と理由） | 素通り。存在しない hash に対する `UPDATE` は 0 行で終わり、`ok:true` を返す。meta は null・未定義のフィールドを無視し、更新するものがなくても `ok:true` | × 400 はクライアントへ返るだけで、受け手（§4.3 の #11・#12）も握りつぶす | なし |
| S-14 | [server.js:948-963](../../server.js) | 未定義の `/api/*` パス | `api` ルーターに定義されたパス | 寄せる。Fran は `npm run dev` で動いている（[README.md:31](../../README.md)）。このため GET/HEAD で `Accept: */*`（fetch の既定）なら、Vite 5.4.21 の SPA フォールバックが `index.html` を **200** で返す。GET/HEAD 以外は Express 既定の 404（HTML）になる | × サーバ側には何も残らない。フロントの扱いは F-05 | なし |
| S-15 | [server.js:255-275](../../server.js) | CORS の Origin | `ALLOWED_ORIGINS`・`*.prompt-vault-6gr.pages.dev` | 素通り。許可ヘッダを付けずに次の処理へ渡す。許可外の preflight には 204 を返さず、ルートへ流れる | × サーバ側には何もない。ブラウザが遮断し、フロントは `ネットワークエラー [Fran]` と表示する（一過性） | pv#23（照合規則の正否のみ） |
| S-16 | [server.js:15-27](../../server.js), [:40](../../server.js), [:217-234](../../server.js) | `.env` 行・`PORT`・`VAULT_ROOT` | `KEY=VALUE` 行。既にある環境変数を優先する | `=` のない行は黙って捨てる。`PORT` は数値か確かめずに `listen` へ渡す。`VAULT_ROOT` が存在しなければ `.tmp` 作成エラーが `console.error` に出て、走査は S-07 になる | △ console のみ（捨てた行は ×） | なし |
| S-17 | [server.js:71-83](../../server.js), [:100-107](../../server.js), [:965-968](../../server.js) | `settings.json`・`cards.json`・`presets.json` の JSON 解析 | 解析成功 | 例外 → エラーハンドラ | ○ `UNHANDLED`（message と stack） | なし |
| S-18 | [server/queue.js:10-21](../../server/queue.js), [:140-143](../../server/queue.js) | キューのガード値 | `null`・未定義でない値 | 既定に寄せる、または素通り。設定が解析できなければ黙って既定値を使う。値は `??` でしか検査しないので、文字列や `NaN` は素通りする。`sleep(NaN)` は待たないので、間隔ガードが外れる | × | なし |
| S-19 | [queue.js:52-65](../../server/queue.js) | キュー追加タスクの各フィールド | 真値 | 既定に寄せる。`label` が空なら `（ラベルなし）`、`params` が空なら `{}` になる。未知のフィールドは黙って捨てる。`params` の中身は S-04 へそのまま流れる | × | なし |
| S-20 | [server.js:808-813](../../server.js) | `/debug/errors` で読むログ行 | JSON として解析できる行 | 黙って捨てる | × | なし |
| S-21 | [server.js:133-151](../../server.js) | danbooru CSV | 3 列以上で先頭が空でない行 | 列が足りない行は黙って捨てる。件数が解析できなければ 0。ファイルの読込に失敗したら `DANBOORU_LOAD` | △ 行単位は ×。ファイル単位は ○ | なし |
| S-22 | [server.js:164-169](../../server.js), [:177](../../server.js) | M2→M3 移行での `presets.json` | 解析成功、配列のフィールド | 記録する（console のみ）。解析に失敗したら `console.warn` して移行しない。印を付けないので、起動するたびにやり直す。配列でないフィールドは黙って読み飛ばす | △ console | なし |

## 4. フロント側（src/・public/）

### 4.1 接続経路（Fran／Cloud）の振り分け

| ID | 箇所 | 振り分けの対象 | 当たる枝 | 当たらないときの扱い | 観測先（残るもの） | 試験 |
|---|---|---|---|---|---|---|
| F-01 | [src/lib/connection.js:41-58](../../src/lib/connection.js), [:25-33](../../src/lib/connection.js) | localStorage `pv-connection` の解析と値 | JSON として解析でき、各キーがある | 既定に寄せる、または素通り。解析に失敗したら黙って `DEFAULTS`（offline）を返す。壊れた値はそのまま残す。`route`・`token`・`cloudOfflineReason` の値は検査しない（URL と `revision` だけ正規化する） | × | pv#49（`revision` の正規化のみ） |
| F-02 | [src/lib/api.js:20-26](../../src/lib/api.js) / [connection.js:223-233](../../src/lib/connection.js) / [api.js:134](../../src/lib/api.js) / [Header.jsx:92-104](../../src/components/Header.jsx) / [SettingsScreen.jsx:663-707](../../src/screens/SettingsScreen.jsx) / [GenerateScreen.jsx:437-451](../../src/screens/GenerateScreen.jsx) / [App.jsx:163](../../src/App.jsx) | `route` の値 | `fran`・`cloud`（と `offline`） | 寄せ先が箇所ごとに違う。`request()` は offline として例外。`resolveThumbUrl`・`getThumb` は Fran の URL。ヘッダと設定画面は「未接続」と出し、切替ボタンは「Franへ切替」を出す。生成画面の読込は Fran の枝に入る。30 秒ごとの再確認は予約されない | △ 画面には「未接続」と出るが、元の値は出ない | なし |
| F-03 | [connection.js:91-96](../../src/lib/connection.js), [SettingsScreen.jsx:816-823](../../src/screens/SettingsScreen.jsx) | 到達確認のタイムアウト値 | 正の数値 | 素通り。`Number(v)` の結果が `NaN`・0・負でもそのまま `setTimeout` に渡る。入力欄を空にすると `Number('')` で 0 が保存される。0 のときは確認が即座に打ち切られ、二つの経路とも失敗扱いになり、offline（reason は null）に落ちる | × 「未接続」になるだけで、原因は出ない | なし |
| F-04 | [connection.js:98-111](../../src/lib/connection.js), [:149-174](../../src/lib/connection.js), [App.jsx:189-199](../../src/App.jsx) | 到達確認の結果の種別 | Fran `/healthz` 2xx → fran。Cloud `/settings`: 2xx → cloud、401/403 → `auth-failed`、それ以外 → `cloud-error` | 黙って捨てる、または寄せる。Fran 側は、通信失敗・タイムアウト・CORS・2xx 以外の区別を `false` 一つにまとめ、理由を捨てる。Cloud `/healthz` が 2xx 以外のとき（401/403 を含む）は reason=null の offline になる。コメント（[:155](../../src/lib/connection.js)）にあるとおり healthz は入口照合の内側にあるので、トークンが不正だとここで 401 になり、通信失敗と区別できない。`/settings` の残余は `cloud-error` という型にまとまるが、元の status は残らない。App では reason が null か未知の値ならトーストを出さない | △ `cloud-error` は `warn` トースト（F-07 で info 表示になる）。それ以外は × | pv#53（`/settings` の 401、両方とも通信失敗）。healthz の 401 と `/settings` の 5xx・404 は試験がない |
| F-05 | [api.js:39-63](../../src/lib/api.js) | 業務 API の応答 | 2xx かつ JSON。401/403/404/5xx/その他の 4xx（`API エラー (status)`）は status を残す | 2xx で JSON でない本文（S-14 の `index.html`）は、`res.json()` の SyntaxError がそのまま上がる。path・route・status は付かない。エラー本文が JSON でなければ、詳細は黙って空になる | △ 呼び出し側がトーストを出す箇所ではそのまま表示する（一過性）。握りつぶす箇所（§4.3）では × | pv#56（base URL のみ） |

### 4.2 状態値・応答形・保存値の振り分け

| ID | 箇所 | 振り分けの対象 | 当たる枝 | 当たらないときの扱い | 観測先（残るもの） | 試験 |
|---|---|---|---|---|---|---|
| F-06 | [GenerateScreen.jsx:63-69](../../src/screens/GenerateScreen.jsx) | `/queue/task/<id>/data` の応答状態 | 2xx → 復号。404 → 期限切れ | 黙って捨てる。401・403・5xx などは `{expired:false, plain:null}` になり、画像も「期限切れ」も出ない | × | pv#81（404 のみ） |
| F-07 | [src/components/Toast.jsx:3-9](../../src/components/Toast.jsx), [:16](../../src/components/Toast.jsx), [:35](../../src/components/Toast.jsx) | トーストの型 | `success`・`error`・`info` | 近い型に寄せる。実際に使われている `warn`（[App.jsx:197](../../src/App.jsx)）と `warning`（[GenerateScreen.jsx:1118](../../src/screens/GenerateScreen.jsx)）は、`info` の見た目と表示時間で出る。`console.error` は `error` 型にしか出ない | △ 一過性の表示のみ | なし |
| F-08 | [GenerateScreen.jsx:78](../../src/screens/GenerateScreen.jsx), [:125](../../src/screens/GenerateScreen.jsx), [:1457-1464](../../src/screens/GenerateScreen.jsx), [:481](../../src/screens/GenerateScreen.jsx), [:1502-1521](../../src/screens/GenerateScreen.jsx) | キューのタスク `status`・キュー `state` | status: `pending`/`running`/`done`/`error`/`skipped`。state: `running`/`paused`（それ以外は空表示） | 寄せる。未知の status は「?」アイコン（元の値は出ない）。未知の state はラベルが空になり、ポーリングもしない。実行・クリアのボタンが出る（停止中と同じ扱い）。いまの Worker（PvQueue.js）が出す値は state が idle/running/paused、status が pending/running/done/error で、すべて当たる | △ 画面に「?」が出るだけ | なし |
| F-09 | [GenerateScreen.jsx:1078-1099](../../src/screens/GenerateScreen.jsx) | Cloud 単発生成の応答の形 | `result.image.hash` あり → Cloud の扱い。`task_id` あり → 画像取得 | 近い型に寄せる。`image.hash` がなければ else 枝（Fran の扱い）に入り、画像の URL が Fran の `.tmp` を指す。`task_id` がなければ期限切れ扱い | △ 画面に壊れた画像か「期限切れ」が出る。原因は出ない | なし |
| F-10 | [GenerateScreen.jsx:309-321](../../src/screens/GenerateScreen.jsx), [:454](../../src/screens/GenerateScreen.jsx), [:763-765](../../src/screens/GenerateScreen.jsx), [:851](../../src/screens/GenerateScreen.jsx), [:873](../../src/screens/GenerateScreen.jsx) | 前回プロンプト（localStorage）・設定の既定モデル・解像度・seed | `MODELS`・`SAMPLERS`・`RESOLUTIONS`・`random` | 素通り、または寄せる。未知の model・sampler は状態にそのまま入り、選択欄の表示と食い違ったまま S-03/S-04 へ送られる。未知の resolution は Portrait に寄せる。seed の `parseInt` が `NaN` なら JSON で null になり、乱数に寄せられる | × | なし |
| F-11 | [SettingsScreen.jsx:14-19](../../src/screens/SettingsScreen.jsx), [:417-425](../../src/screens/SettingsScreen.jsx) | 設定画面の既定モデル | V4.5 Full/Curated、V4 Full、V3（V5 系がない） | 寄せる（表示のみ）。V5 系の値が入っていると、選択欄には先頭の V4.5 Full が見え、保存される値は V5 のまま | × | なし |
| F-12 | [src/lib/crypto.js:61-74](../../src/lib/crypto.js), [:76-78](../../src/lib/crypto.js), [:110-118](../../src/lib/crypto.js), [SettingsScreen.jsx:223-232](../../src/screens/SettingsScreen.jsx) | vault 鍵の記録・暗号文の鍵 id | 正しい base64 の 256bit 鍵。暗号文の形式は `[idLen][keyId][IV][本文]` | 素通り、または寄せる。インポートでは base64 か・長さが正しいかを確かめずに保存する（使うときに `atob`・`importKey` が例外を出す）。記録が解析できなければ `null`（未設定）に寄せる。暗号文の `keyId` は長さを読むだけで、照合しない（鍵の世代を振り分けない） | × 復号の失敗は呼び出し側がすべて握りつぶす（§4.3 の #1・#7・#8・#13・#15・#17・#20・#21） | なし |

### 4.3 失敗を握りつぶす箇所（27 件）

すべて「黙って捨てる」で、観測先は **×**、試験は **なし**（pv#81 は 404→期限切れの対応だけを見る）。

| # | 箇所 | 握りつぶすもの |
|---|---|---|
| 1 | [GenerateScreen.jsx:105](../../src/screens/GenerateScreen.jsx) | キュー行の画像取得・復号の例外 |
| 2 | [GenerateScreen.jsx:89](../../src/screens/GenerateScreen.jsx) | キュー行の `task.result` が JSON として解析できない（null 扱いになる） |
| 3 | [GenerateScreen.jsx:427](../../src/screens/GenerateScreen.jsx) | タブ復帰時のプリセット再取得の失敗 |
| 4 | [GenerateScreen.jsx:448-450](../../src/screens/GenerateScreen.jsx) | Cloud の初回読込（cards/presets/queue）の失敗。メッセージに `認証エラー` を含むもの以外は表示しない |
| 5 | [GenerateScreen.jsx:483](../../src/screens/GenerateScreen.jsx) | キューのポーリングの失敗 |
| 6 | [GenerateScreen.jsx:501-506](../../src/screens/GenerateScreen.jsx) | 完了タスクの `result` が解析できない。先に `addedTaskIdsRef` に加えてから `return` するので、そのタスクは以後も結果一覧に出ない |
| 7 | [GenerateScreen.jsx:524](../../src/screens/GenerateScreen.jsx) | 完了タスクの画像取得・復号の例外 |
| 8 | [GenerateScreen.jsx:1086](../../src/screens/GenerateScreen.jsx) | 単発生成の画像取得・復号の例外 |
| 9 | [GenerateScreen.jsx:1123](../../src/screens/GenerateScreen.jsx), [:1482](../../src/screens/GenerateScreen.jsx) | 保存後のサムネイル作成・アップロードの失敗 |
| 10 | [src/lib/thumbGen.js:80-82](../../src/lib/thumbGen.js) | サムネイル PUT の応答状態を見ていない。2xx 以外も成功と区別しない |
| 11 | [ImageViewer.jsx:238-240](../../src/components/ImageViewer.jsx) | お気に入り更新の失敗（サーバの 400 を含む）。表示を黙って戻す |
| 12 | [ImageViewer.jsx:257](../../src/components/ImageViewer.jsx) | セリフ保存の失敗（サーバの 400 を含む） |
| 13 | [ImageViewer.jsx:91](../../src/components/ImageViewer.jsx) | ビューアの画像取得・復号の失敗。2xx 以外は `null` に寄せる（[:72](../../src/components/ImageViewer.jsx)・[:82](../../src/components/ImageViewer.jsx)） |
| 14 | [ImageViewer.jsx:140](../../src/components/ImageViewer.jsx) | 画像詳細の取得の失敗 |
| 15 | [AlbumScreen.jsx:124-126](../../src/screens/AlbumScreen.jsx) | サムネイル取得（3 回まで再試行）・復号の失敗。⟳ が出たままになる |
| 16 | [AlbumScreen.jsx:122-123](../../src/screens/AlbumScreen.jsx) | IndexedDB 保存、サムネイル生成・アップロードの失敗 |
| 17 | [AlbumScreen.jsx:204](../../src/screens/AlbumScreen.jsx) | フォルダのプレビュー画像の取得・復号の失敗。2xx 以外は `null` に寄せる（[:197](../../src/screens/AlbumScreen.jsx)） |
| 18 | [AlbumScreen.jsx:303](../../src/screens/AlbumScreen.jsx) | ルート読込の失敗のうち、メッセージに `400` を含むものすべて（`VAULT_ROOT未設定` に限らない） |
| 19 | [AlbumScreen.jsx:396-400](../../src/screens/AlbumScreen.jsx) | リスキャン状態のポーリングの失敗。黙って止める |
| 20 | [TemplateCardList.jsx:33](../../src/screens/TemplateCardList.jsx), [TemplatePresetList.jsx:33](../../src/screens/TemplatePresetList.jsx) | テンプレートのサムネイル取得の失敗 |
| 21 | [src/lib/api.js:137-143](../../src/lib/api.js) | `getThumb` の取得・復号の失敗（`null` を返す） |
| 22 | [TemplateCardList.jsx:90](../../src/screens/TemplateCardList.jsx), [TemplatePresetList.jsx:85](../../src/screens/TemplatePresetList.jsx) | カード別・プリセット別ギャラリーの取得の失敗（0 件に寄せる） |
| 23 | [TagSuggest.jsx:35](../../src/components/TagSuggest.jsx) | タグ候補の取得の失敗 |
| 24 | [App.jsx:125-127](../../src/App.jsx) | 結果保持件数の設定取得の失敗（5 件に寄せる） |
| 25 | [App.jsx:143](../../src/App.jsx), [:145](../../src/App.jsx), [:165](../../src/App.jsx) | 到達確認の Promise の reject |
| 26 | [SettingsScreen.jsx:134](../../src/screens/SettingsScreen.jsx), [:246-251](../../src/screens/SettingsScreen.jsx) | システム情報・版・直近エラーの取得の失敗 |
| 27 | [thumbDb.js:25](../../src/lib/thumbDb.js), [:36](../../src/lib/thumbDb.js), [:48](../../src/lib/thumbDb.js) | IndexedDB の読み書きの失敗 |

### 4.4 内部状態だけの振り分け（一行のみ）

- F-14 [App.jsx:228-230](../../src/App.jsx): 未知の `activeTab` は「未実装のタブです」と画面に出る（△）
- F-15 [TemplateCardList.jsx:151-167](../../src/screens/TemplateCardList.jsx)・[TemplatePresetList.jsx:154](../../src/screens/TemplatePresetList.jsx): 未知の `nav.view`、または選択中のスロットが消えている場合は、一覧の最上位へ寄せる（×）
- F-16 [public/sw.js:19-28](../../public/sw.js), [:47-53](../../public/sw.js): `/api` は別オリジンなので L19 で素通りし、L21 の枝には実質入らない。`CLEAR_CACHE` 以外のメッセージは黙って捨てる（×）
- F-17 [GenerateScreen.jsx:880](../../src/screens/GenerateScreen.jsx): 直積モードの未知の値は `fixed` に寄せる（×）
- F-18 [App.jsx:14-20](../../src/App.jsx): `resolveResultsOwner` は fran・cloud 以外の経路では持ち主を変えない（offline を想定した意図どおりの枝。未知の値も同じ扱いになる）（×）

## 5. スクリプト（scripts/）

| ID | 箇所 | 振り分けの対象 | 当たる枝 | 当たらないときの扱い | 観測先（残るもの） | 試験 |
|---|---|---|---|---|---|---|
| T-01 | [scripts/verify-issues.mjs:66-78](../../scripts/verify-issues.mjs), [:92-99](../../scripts/verify-issues.mjs) | verifier が返す check の `status` | `PASS`・`FAIL`・`NOT_RUN`・`WAIVED` | 近い型に寄せる。未知の値（`ERROR`・小文字の `pass`・`undefined` など）があっても、Issue の判定は **PASS** になる。集計のどの欄にも数えられず、終了コードは 0。未登録の Issue ID のほうは `UNKNOWN`/FAIL として記録される | △ 標準出力の行には元の値が出るが、判定と集計からは消える | なし |
| T-02 | [scripts/inspect.mjs:84-100](../../scripts/inspect.mjs) | 版確認の healthz 応答 | JSON の `version` | 寄せる。HTTP の異常や JSON でない応答も、すべて「Server not running — NOT_RUN」になる | △ console に NOT_RUN と出るが、理由は出ない | なし |
| T-03 | [scripts/review-doctor.mjs:58-71](../../scripts/review-doctor.mjs), [:580](../../scripts/review-doctor.mjs) | CLI 引数 | 定義済みのフラグ。未知の引数は exit 64 | `--port=abc` は `NaN` → 偽値なので、黙って PORT/.env/8789 に寄せる。`--timeout-ms=abc` は `NaN` のまま素通りする | × | なし |
| T-04 | [scripts/orphan-cards-report.mjs:11-22](../../scripts/orphan-cards-report.mjs) | CLI 引数 | `--json`・`--help` | 例外（exit 64、引数を stderr に出す） | ○ その場の出力。判定は `UNKNOWN` 残余付き | なし |
| T-05 | [scripts/review-doctor.mjs:541-544](../../scripts/review-doctor.mjs) | 総合判定 | COMPATIBLE・REPAIR_REQUIRED・UNKNOWN | 残余の型（UNKNOWN、exit 3）がある | ○ その場の出力 | なし |
| T-06 | [scripts/normalize-cards.mjs:28-33](../../scripts/normalize-cards.mjs) | カードの `slotId` | 実在するスロット | 黙って捨てる（削除）。孤児カードを削除し、ID だけを console に出す。削除したカードの中身は残らない | △ console | なし |

T-04・T-05 は手動実行の診断ツールで、残余の型を持つので一行扱いでよい項目にあたる。

## 6. 集計

| 区分 | ○ | △ | × | 計 |
|---|---|---|---|---|
| サーバ（S-01〜S-22） | 1（S-17） | 9（S-01, S-02, S-05, S-07, S-08, S-09, S-16, S-21, S-22） | 12 | 22 |
| フロント主表（F-01〜F-12） | 0 | 6（F-02, F-04, F-05, F-07, F-08, F-09） | 6 | 12 |
| フロント一行（F-14〜F-18） | 0 | 1 | 4 | 5 |
| スクリプト（T-01〜T-06） | 2（T-04, T-05） | 3 | 1 | 6 |
| **主表 計** | **3** | **19** | **23** | **45** |
| 握りつぶし（§4.3） | 0 | 0 | 27 | 27 |

注:
- S-09 は「寄せる」枝が ×、「例外」の枝が ○ なので △ に数えた。S-21 も行単位が ×、ファイル単位が ○ なので △ に数えた
- 集約先（`logs/`）に残る ○ は、サーバでは S-17 の 1 件だけ（S-21 のファイル読込失敗の枝を含めれば 2 枝）。T-04・T-05 は手動ツールのその場の出力
- 「一つの集約先で観測でき、試験もある」箇所はない（S-17 は試験がない）。このため一行扱いにした箇所はない（§4.4 は内部状態だけの振り分けなので短く書いた）

## 7. 調べ方

- `server.js`・`server/` の全ファイル、`src/lib/` の全ファイル、`src/App.jsx`、`src/screens/GenerateScreen.jsx`・`SettingsScreen.jsx`・`AlbumScreen.jsx`、`src/components/Toast.jsx`・`Header.jsx`・`Footer.jsx`、`public/sw.js` を全文読んだ
- `ImageViewer.jsx`・テンプレート系の画面・`TagInput`/`TagSuggest`・`scripts/` は、振り分け（`if`/`?:`/`switch`/`===`/`catch`/`.ok`/`JSON.parse`/`argv`/`env`）を grep で拾い、該当する前後を読んだ
- 試験の有無は `tests/issues/manifest.mjs` に登録された 17 本の verifier の check 名と入力を読んで判定した。CI（`.github/workflows/ci.yml`）が回すのは `build` と `inspect` だけで、`verify:issues` は CI では回っていない
- S-14 の Vite フォールバックの条件は、`node_modules/vite`（5.4.21）の `htmlFallbackMiddleware` で確かめた。実機での確認はしていない
- F-08 の Worker 側の値は、ai-family-foundation `32a0aa4` の `src/worker/do/PvQueue.js` を grep して確かめた（読み取りのみ）
