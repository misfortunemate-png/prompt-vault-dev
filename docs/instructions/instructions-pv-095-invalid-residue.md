# prompt-vault 当たらない入力の観測化 修正指示書（prompt-vault v4.1.0）
文書種別: 権威文書

作成日: 2026-10-02 ／ PM ／ 対応仕様: 本書 ／ 対応要件: pv#95（親）と子 Issue pv#98〜pv#103 の「受入れの要点」 ／ 規則: CLAUDE.md「コードの規則」C-1・C-2（PR #97。未マージの間は PR #97 の差分を正とする） ／ 本書一枚で完結（追補なし）

## 添付マニフェスト（着工前照合・必須）

以下がすべて存在すること。**1つでも欠けたら着工せず docs/reports/ に報告。**

| # | パス／参照 | 種別 | SHA-256 |
|---|---|---|---|
| 1 | docs/instructions/instructions-pv-095-invalid-residue.md | 指示書（本書） | — |
| 2 | docs/reports/report-95-invalid-residue.md | 調査回答（箇所 ID の正・対象 main `91118ff`） | — |
| 3 | pv#95 と子 Issue pv#98〜pv#103 の本文・PM コメント | 要件・裁定の記録 | — |
| 4 | PR #97（CLAUDE.md「コードの規則」C-1・C-2） | 規則 | — |

支給物なし。`91118ff` から HEAD `d284b79` までにコードの変更はない（docs のみ）。報告書の file:line はそのまま使える。

## PG運用規律（定型・全フェーズ共通）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**: PM支給物はdiffゼロで検収される。技術的整合の調整もPMへ差し戻す
3. **発注者指示による仕様外修正**: 発注者から直接指示を受けた修正は実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記する。権威文書は書き換えない
4. **着工前**: `git pull` → inspect実行（マニフェスト照合・版確認）。緑でなければ着工しない。着工確認はチャット定型②で発話する
5. **稼働設定の変更三手順**: 稼働中の共有インフラ設定（ポート・serve/funnel等）に触れる場合は、状態記録→スクリプト一本で変更→差分確認の順とする。アドホックなコマンド連打での変異は禁止（#018）

## 作業範囲

- 何を: 調査回答書 §3〜§5 の全箇所（S-01〜S-22・F-01〜F-12・F-14〜F-18・§4.3 #1〜#27・T-01〜T-06）に残余の型を持たせ、当たらなかったものを集約先に残す。子 Issue ごとの割り当ては各 Issue の「事象」欄が正
- なぜ: C-1・C-2（全リポジトリ適用・2026-10-02 発注者）
- どこで: prompt-vault-dev（server.js・server/・src/・public/・scripts/・tests/）。ai-family-foundation（Worker）は対象外

## 裁定（PM確定事項）

### 共通

- **J-1 集約先**（pv#98）: 書き込み先は実行環境ごとに一つずつとし、見る場所を一つにする
  - Fran: 既存の `logs/YYYY-MM-DD.log`（`writeLog`）に code `INVALID` で書く。欄は `kind`（種別）・`stage`（段＝報告書の箇所 ID と関数名）・`raw`（元の字句）・`reason`（理由）。既存の 7 種の code はそのまま
  - フロント: ブラウザ内に集約先を一つ置く。再読み込みで消えないこと・件数の上限を持つこと（上限値と保存方式は PG 裁量、報告に記す）
  - 見る場所: 設定 →「デバッグ・接続」に、フロントの集約先と、いま接続中の経路の `/debug/errors` を並べて出す。**経路が offline でもフロントの分は見えること**
  - `src/lib/errors.js` は集約先に統合するか取り除く。仕組みを二つ並べない
  - 同じ `kind`・`stage`・`raw` が続く場合は件数を数えて一つにまとめてよい（上限で本当の残余が押し流されないため）。件数は消さない
- **J-2 当たる枝と残余の境目**: コードがすでに定めて扱っている結果（例: pv#81 の 404 →「期限切れ」、いまの Worker が出す state `idle`、実際に使われているトースト型 `warn`・`warning`）は当たる枝として明示する。集約先に送るのは、どの枝にも当たらなかったものだけ。各箇所で当たる枝として定めた値を報告に列挙すること
- **J-3 秘密を raw に残さない**: トークン・vault 鍵・NovelAI の鍵・`Authorization` の値は raw に書かず、種別と長さだけを残す（F-01 の `pv-connection`・F-12 の鍵インポートが該当）。認証情報そのもの（値・照合方式・保存場所）は変えない（R-020 改訂・2026-09-23）
- **J-4 表示**: 集約先への記録はすべての残余で行う。トーストは、利用者が自分で行った操作が失敗したとき（保存・お気に入り・セリフ・鍵インポート・生成）に限る。裏で走る取得（サムネイル・タグ候補・ポーリング・到達確認）は記録だけにし、トーストを連発しない
- **J-5 応答の形を変える箇所の扱い**: HTTP の状態コード・応答の形を変える前に、その経路の呼び出し元をすべて確かめる（フロント・`scripts/`・ai-family-ops の pv-sync 系は読み取りのみ）。**フロント以外の呼び出し元がある経路（`/gallery/sync-inventory`・`/gallery/image/:hash/meta` ほか）は応答を変えず、記録だけにする**。呼び出し元が確かめきれない経路も同じ扱い

### 書き込み・有料呼び出し（pv#100・pv#101）

- **J-6 書き込みは確かめてから**: 保存・削除・置き換えの経路で当たらない入力が来たら、書き込まずに 4xx で拒み、集約先に残す（S-10・S-11・S-12・S-13）。既定に寄せて書くこと・未知のキーを合流させることはしない
  - 正の対照（これが通らなければ停止）: いまの Fran の `settings.json`・`cards.json`・`presets.json` の実物と、いまのフロントが送る本文はすべて受け付けられること
  - S-13 の 0 行更新は、フロントだけが呼ぶ経路（favorite・caption）は 404 にする。meta は J-5 により記録だけ
- **J-7 消す前に残す**: T-06 は、削除するカードの中身全体を集約先に残してから削除する。normalize-cards の削除の判定そのものは変えない
- **J-8 鍵**（F-12）: インポート時に base64・長さを確かめ、当たらなければ保存しない。暗号文の keyId が手元の鍵と違うものは記録する。鍵の世代を振り分ける仕組みは作らない
- **J-9 有料呼び出しは寄せずに止める**（pv#101）: NovelAI を呼ぶ前の値（S-03 モデル・S-04 生成パラメータ・S-18 キューのガード値・S-19 タスク）に当たらないものがあれば、**呼ばずに**拒み（単発は 4xx、キューは開始しない）、集約先に残す
  - 未指定（`undefined`・`null`・空文字）は従来どおり既定値を使ってよい。指定されたが値域外・型違い（`NaN`・数値でない文字列・未知の sampler・未知のモデル）を拒む
  - 正の対照: いまのフロントの選択肢（MODELS・SAMPLERS・RESOLUTIONS）と設定画面の既定モデルのすべてが受け付けられること
  - S-18 は、ガード値が当たらないとき既定値で走らせない。キューを開始せず、理由を画面と集約先に出す
- **J-10 NovelAI 応答の種別**（S-01・S-02・S-05）: 401・402・429・5xx・その他を別の種別として残す。単発・キューの両経路とも集約先に残す（キューの `task.error` だけにしない）。S-02 は raw に Content-Type と本文の先頭を残す。**再試行・待機などの振る舞いは足さない**

### 接続経路（pv#102）

- **J-11** 未知の `route` は一か所で offline として扱い、元の値を記録する。箇所ごとに寄せ先が違う状態（F-02）をなくす。pv#44・pv#47・pv#49・pv#53・pv#56 の柵は変えない
- **J-12** F-04: Cloud `/healthz` の 401・403 は `auth-failed` に分ける。Fran の到達確認の失敗は理由（通信失敗・タイムアウト・2xx 以外の status）を残す
- **J-13** S-14: 未定義の `/api/*` は、メソッドを問わず JSON の 404 を返し、集約先に残す（Vite の SPA フォールバックより先に受ける）
- **J-14** F-11: 設定画面の既定モデルの選択肢は変えない。一覧にない保存値は、その値のまま「一覧にない値」として見せ、記録する

### 検査スクリプト（pv#99）

- **J-15** 検査ツール（verify-issues・inspect・review-doctor）は Fran のログに書かない。残余は判定（`UNKNOWN` 等）・終了コード（0 以外）・出力（元の字句と理由）で出す
- **J-16** T-01 の修正で、**既存の verifier が PASS から変わったら、その verifier を直さずに停止して報告する**（これまでの PASS が空だったことになるため、扱いは PM が決める）

### pv#103 の扱い

- **J-17** pv#103 にラベル「軽微」を付けた（PM 裁量・2026-10-02 21:35 の運用）。PG が修正し、PM 検収を待たずにクローズしてよい。クローズの最終コメントに commit SHA と、当たらない入力の試験の赤→緑を記す。ただし作業中に J-5 に当たる箇所（応答の形を変える）や書き込み・有料呼び出しに関わる箇所が見つかったら、その箇所は軽微から外して停止報告する
- S-06: PNG のテキストチャンクで対象外のキーワードは正常な入力なので、明示的に読み飛ばす枝として定める（記録しない）。`Description`・`Comment` を読もうとして読めなかったもの（JSON 解析失敗・`zTXt`・圧縮 `iTXt`）は記録する
- S-16: 起動できない値（数値でない `PORT` 等）は起動を止めて理由を出す。起動できる値の残余（`=` のない行・存在しない `VAULT_ROOT`）は記録して起動を続ける。再起動の前に、いまの `.env` がすべて当たることを確かめる（当たらなければ再起動せず停止報告）
- S-22: 記録するだけにする。移行の振る舞い（毎起動のやり直し）は変えない
- F-18: offline を想定した意図どおりの枝。fran・cloud・offline 以外を残余として記録する

## 影響範囲（PM調査済み——「ここが全部だ」）

検索キーワード: `writeLog` ／ `ErrorCode` ／ `createError` ／ `/debug/errors` ／ `getErrors` ／ `catch {` ／ `catch (` ／ 調査回答書 §3〜§5 の各 file:line

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| server.js | `writeLog`（L127）、`/debug/errors`（L808-813・S-20）、調査回答書 S-05・S-09〜S-17・S-20〜S-22 の各行 | 要修正 |
| server/providers/novelai.js | S-01〜S-03 | 要修正 |
| server/generate.js | S-04・S-08・S-09 | 要修正 |
| server/queue.js | S-18・S-19、`task.error`（L120） | 要修正 |
| server/png-meta.js | S-06 | 要修正 |
| server/scanner.js | S-07・S-08 | 要修正 |
| server/db.js | S-13（L152-195） | 要修正 |
| src/lib/errors.js | 未使用（import 0 件） | 統合または除去（J-1） |
| src/lib/（新設の集約先モジュール） | J-1 | 新設 |
| src/screens/SettingsScreen.jsx | `loadDebug`（L246-256）・「直近エラー一覧」（L760 付近）・F-03・F-11・F-12・§4.3 #26 | 要修正 |
| src/lib/connection.js ／ src/lib/api.js | F-01〜F-05、§4.3 #21 | 要修正 |
| src/lib/crypto.js | F-12 | 要修正 |
| src/lib/thumbGen.js ／ src/lib/thumbDb.js | §4.3 #10・#27 | 要修正 |
| src/App.jsx | F-02・F-04・F-14・F-18、§4.3 #24・#25 | 要修正 |
| src/components/Toast.jsx | F-07 | 要修正 |
| src/components/Header.jsx | F-02 | 要修正 |
| src/components/ImageViewer.jsx | §4.3 #11〜#14 | 要修正 |
| src/components/TagSuggest.jsx | §4.3 #23 | 要修正 |
| src/screens/GenerateScreen.jsx | F-02・F-06・F-08〜F-10・F-17、§4.3 #1〜#9 | 要修正 |
| src/screens/AlbumScreen.jsx | §4.3 #15〜#19、S-07 の `incomplete` | 要修正 |
| src/screens/TemplateCardList.jsx ／ TemplatePresetList.jsx | F-15、§4.3 #20・#22 | 要修正 |
| public/sw.js | F-16 | 要修正 |
| scripts/verify-issues.mjs ／ inspect.mjs ／ review-doctor.mjs ／ normalize-cards.mjs | T-01〜T-03・T-06 | 要修正 |
| scripts/orphan-cards-report.mjs | T-04・T-05（残余の型あり） | 確認のみ |
| tests/issues/manifest.mjs と新設 verifier | pv#98〜pv#103 | 要修正・新設 |
| package.json | 版 4.1.0 | 要修正 |
| ai-family-ops の pv-sync 系 | Fran API の呼び出し元（J-5） | 確認のみ（読み取り・変更禁止） |
| ai-family-foundation（Worker `/api/prompt-vault/*`・PvQueue） | 応答の値の確認のみ（F-08 の `idle` 等） | 対象外（変更禁止） |

（PGは表にない箇所を触る場合、停止条件1で報告する）

## 作業手順

1. `git pull` → inspect 緑を確認し、チャット定型②で着工を発話
2. 子 Issue の順に進める: **pv#98 → pv#99 → pv#100 → pv#101 → pv#102 → pv#103**。1 Issue ＝ 1 コミット以上。コミット本文に Issue 番号を書く
3. 各 Issue で、**先に verifier（`tests/issues/pv-0NN-*.mjs`・key `pv#NN`）を書き、いまのコードで赤になることを記録してから**直す。直した後に緑を記録する
4. 各 Issue を終えるたびに `verify:issues` 全件と inspect を回す（J-16 に当たれば停止）
5. 全 Issue を終えたら版を 4.1.0 にし、Fran を再起動する（S-16 の `.env` の確認を先に行う）。フロントを README の手順で pages.dev に公開する
6. pv#103 は J-17 によりクローズまで行う。pv#98〜pv#102 はクローズしない（PM 検収）
7. 報告書を書き、チャット定型③で完了を発話

## 禁止事項

- 当たらないものを既定値・近い型に寄せて進めること（J-9 の「未指定」を除く）
- テストで NovelAI を実際に呼ぶこと（有料。モックで行う）
- NovelAI 呼び出しに再試行・待機を足すこと（J-10）
- フロント以外の呼び出し元がある経路の応答を変えること（J-5）
- 秘密の値を集約先・ログ・画面に出すこと（J-3）
- 認証情報（トークンの値・照合方式）・family-auth に触れること
- ai-family-foundation・ai-family-ops のコードを変えること
- 既存 verifier を、PASS を保つために書き換えること（J-16）
- `docs/supplied/` を変えること

## 検証計画（受入基準との対応・これが検収の正になる）

| AC | Issue | 検証項目（手順） | 手段 | 証跡様式 | negative control |
|---|---|---|---|---|---|
| AC-1 | pv#98 | Fran で残余を一つ起こすと `logs/` に `code: INVALID` と kind・stage・raw・reason が載り、`/debug/errors` で返る。`/debug/errors` は解析できない行を黙って捨てない（S-20） | verifier `pv#98` | verifier 出力 | 有（いまは `INVALID` を書く経路がない → 赤） |
| AC-2 | pv#98 | フロントで残余を一つ起こすと集約先に載り、再読み込み後も残り、上限を超えると古いものから落ちる。設定のデバッグに、offline でもフロントの分が出る | verifier `pv#98` | verifier 出力 | 有（いまは集約先がない → 赤） |
| AC-3 | pv#98 | `ErrorCode`・`createError` の並立がない（統合または除去） | verifier `pv#98` | verifier 出力 | 該当なし |
| AC-4 | pv#99 | T-01: 未知の status（`ERROR`・`pass`・`undefined`）を返す verifier の判定が PASS にならず、集計に数えられ、終了コードが 0 でない。T-02: 応答の異常と「起動していない」が理由つきで区別される。T-03: 当たらない引数が理由つきで終了コード 64 になる | verifier `pv#99`（模擬 verifier を fixture に置く） | verifier 出力 | 有（いまは PASS・exit 0 → 赤） |
| AC-5 | pv#100 | S-10・S-11・S-12: 当たらない本文・クエリが 4xx で拒まれ、ファイル・DB はバイト単位で変わらず、集約先に残る | verifier `pv#100` | verifier 出力 | 有（いまは保存される → 赤） |
| AC-6 | pv#100 | J-6 の正の対照: いまの実物の settings／cards／presets と、いまのフロントが送る本文がすべて受け付けられる | verifier `pv#100`（実物の写しを fixture に） | verifier 出力 | 該当なし |
| AC-7 | pv#100 | S-13: 存在しない hash への favorite・caption は 404 と記録。meta は応答が変わらず記録だけ（J-5）。F-12: 壊れた鍵は保存されない・keyId の不一致は記録。T-06: 削除したカードの中身全体が集約先にある。§4.3 #6: 解析できない result のタスクが一覧から永久に外れない。#11・#12: 失敗がトーストと集約先に出る | verifier `pv#100` | verifier 出力 | 有（いまは各々素通り・握りつぶし → 赤） |
| AC-8 | pv#101 | S-03・S-04・S-19: 当たらない値で NovelAI（モック）が**呼ばれず**に拒まれ、記録される。未指定は既定値で通る。J-9 の正の対照がすべて通る | verifier `pv#101` | verifier 出力（モックの呼び出し回数を含む） | 有（いまはモックが呼ばれる → 赤） |
| AC-9 | pv#101 | S-18: ガード値が `NaN`・文字列のときキューが開始されず、理由が集約先に残る | verifier `pv#101` | verifier 出力 | 有（いまは `sleep(NaN)` で間隔なしに進む → 赤） |
| AC-10 | pv#101 | S-01・S-02・S-05: 401・402・429・5xx・その他が別種別で、単発・キューの両方で集約先に残る。F-08・F-09・§4.3 #1・#2・#5・#7・#8 の残余が記録される。いまの Worker の値（state `idle` 等）は残余にならない | verifier `pv#101` | verifier 出力 | 有（いまはキュー経路が記録されない → 赤） |
| AC-11 | pv#102 | F-01〜F-07・F-10・F-11 の残余が J-11〜J-14 のとおり扱われ記録される。Cloud `/healthz` の 401 が `auth-failed` になる。未知の route の寄せ先が一つ | verifier `pv#102` | verifier 出力 | 有（healthz 401 がいま reason=null → 赤） |
| AC-12 | pv#102 | S-14: 未定義の `/api/*` が GET・POST とも JSON の 404 になり記録される。S-15: 許可外の Origin がサーバ側に記録される | verifier `pv#102` | verifier 出力 | 有（いまは GET で 200・index.html → 赤） |
| AC-13 | pv#103 | pv#103 の各箇所（事象欄の全 ID）について、当たらない入力が集約先に残る、または明示した枝に入る。J-17 の S-06・S-16・S-22・F-18 の裁定どおり | verifier `pv#103` | verifier 出力＋Issue クローズコメント | 有（箇所ごと） |
| AC-14 | 全体 | 報告書に、調査回答書の全 ID（72 箇所）について「当たる枝として定めた値／残余の扱い／記録の kind・stage／verifier の check 名」の対応表がある。漏れた ID がない | PG 実行 | 報告書の表 | 該当なし |
| AC-15 | 全体 | 回帰: `verify:issues` 全件 PASS（既存 17 本を含む）・inspect 緑・CI 緑・healthz の version が 4.1.0 | PG 実行／CI | 出力・CI run URL | 該当なし |

- negative control は「現行コードで赤の記録 → 修正後に緑」の両方を証跡に残す
- **実機系（発注者に依頼）**: 設定 →「デバッグ・接続」で、当たらなかった入力の一覧が見えること（PC か Pixel 10 のどちらか）。発注者のタイミングでまとめて実施するので、PG の完了はこれを待たない

## 完了条件

- pv#98〜pv#103 の修正を実装し、Fran 再起動・pages.dev 公開済み
- 検証計画の PG 実行分をすべて実行し、証跡を完了報告に添付済み
- pv#103 はクローズ済み（J-17）。pv#98〜pv#102 は開いたまま
- 版: prompt-vault-dev 4.1.0
- inspect緑・_STATUS.md フロントマター更新・pull・push 実施済み

## 報告基準

報告は docs/reports/report-pv-095-invalid-residue-fix.md に置く（AC対応表様式）。チャット発話は定型③または④のみ。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約（集約先の形・上限値・保存方式を含む）
2. **AC対応表**: | AC | 検証項目 | 結果 | 証跡（生ログ引用 or reports/内パス） |
3. inspect結果（緑/赤と出力の添付）・CI run URL
4. 完了条件の各項に対する充足状況
5. 未完了・未検証の項目があれば列挙（#012・美化しない）
6. 発注者指示による仕様外修正があればその旨と内容
7. サーバー再起動・コミット・プッシュの実施状況
8. AC-14 の対応表（全 72 箇所）
9. J-5 で確かめた呼び出し元の一覧（経路ごと）と、応答を変えた経路・変えなかった経路

## 発令文（PMがpush後チャットへ転写する）

```
【発令】prompt-vault v4.1.0 — 当たらない入力の観測化（pv#98〜pv#103）
作業: 振り分けの残余に型を持たせ、当たらなかった入力を集約先に残す（C-1・C-2）
リポジトリ: prompt-vault-dev ／ Issue: pv#95（親）・pv#98〜pv#103
手順: git pull → docs/instructions/instructions-pv-095-invalid-residue.md を読む
      → マニフェスト照合・inspect緑を確認して着工
報告先: docs/reports/report-pv-095-invalid-residue-fix.md（AC対応表様式）
```
