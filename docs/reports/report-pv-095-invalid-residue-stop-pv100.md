# 停止報告 — pv#95 当たらない入力の観測化（pv#100 着手前）

- 文書種別: 作業文書（PG 停止報告）
- 対応指示書: docs/instructions/instructions-pv-095-invalid-residue.md
- 作業ブランチ: `pv95-invalid-residue-fix`（push 済み・PR 未作成）
- 作成: 2026-10-03 PG
- 停止条件: 指示書「PG運用規律」1（仕様にない判断が必要／仕様どおりだと問題が生じる）

## 0. ここまでの進捗

| Issue | commit | verifier | 赤→緑の記録 |
|---|---|---|---|
| pv#98 集約先 | `88be950` | `pv#98` 16 check PASS | docs/reports/evidence-pv095/pv098-red.txt → pv098-green.txt |
| pv#99 検査スクリプト | `edf75a2` | `pv#99` 31 check PASS | docs/reports/evidence-pv095/pv099-red.txt → pv099-green.txt |

- `verify:issues` 全件: 19 本 PASS（既存 17 本の判定は変化なし。J-16 に当たらない）— pv099-regression.txt
- inspect: 緑（`=== ALL GREEN ===`）— pv099-inspect.txt
- 上記はいずれも作業ブランチ上の証跡。main・本番（Fran 再起動・pages.dev）は未変更

## 1. 事象

pv#100 の着手前に J-5 の呼び出し元を確かめた（読み取りのみ）。pv#100 の対象経路のうち次のものに、**フロント以外の呼び出し元**として ai-family-foundation `scripts/pv-sync.mjs`（`818f6e4`）がある。

| 経路 | pv-sync の箇所 | pv-sync が送る本文 | 指示書の扱い | 食い違い |
|---|---|---|---|---|
| `PUT /settings` | pv-sync.mjs:543 | Cloud の GET settings に Fran の `sync.*` キーを合わせたもの | J-6: 当たらなければ書き込まず 4xx（S-10） | J-5: フロント以外の呼び出し元がある経路は応答を変えず記録だけ |
| `PUT /cards` | pv-sync.mjs:519 | Cloud の GET cards そのまま | 同上 | 同上 |
| `PUT /presets` | pv-sync.mjs:529 | Cloud の GET presets そのまま | 同上 | 同上 |
| `PUT /gallery/image/:hash/caption` | pv-sync.mjs:664 | `{caption, meta_updated_at}` | J-6: 「フロントだけが呼ぶ経路（favorite・caption）」として 0 行更新を 404 | 前提（フロントだけ）が事実と違う |
| `PUT /gallery/image/:hash/favorite` | pv-sync.mjs:677 | `{favorite, meta_updated_at}` | 同上 | 同上 |
| `PUT /gallery/image/:hash/meta` | pv-sync.mjs:691 | `{preset_id, created_at}` | J-5: 応答を変えず記録だけ | なし（指示書どおり） |

pv-sync が呼ぶその他の経路（GET の settings・cards・presets・`/gallery/sync-inventory`・`/gallery/image/:hash`・`/images/full/:hash`・`/thumbs/:hash.webp`・`/healthz`、POST `/rescan`、GET `/rescan/status`）は、pv#100 で応答を変える予定がない。

ai-family-ops には Fran の API を呼ぶコードはない（runner.mjs から pv-sync は撤去済み。`scripts/verify-decommission.mjs` の検査対象）。

### pv-sync の稼働状況

- Windows のスケジュールタスクに pv-sync はない。ai-family-ops の runner からも撤去済み
- 最後の実行ログは foundation `data/sync-20260921.log`（2026-09-21）
- つまり定期実行はされていないが、手動の handback 用としてコードは現役で、J-5 の「呼び出し元」に当たる

### J-6 をそのまま当てた場合に起きうること

- handback は cards → presets → settings の順に Fran へ PUT し、どれかが 2xx 以外なら例外で止まる（fail-closed）。cards を置き換えた後で presets・settings が 4xx になると、**cards だけ置き換わった途中の状態**で止まる
- Cloud 側の本文の形は Fran のフロントが送る形と同じとは限らない。確かめた範囲では:
  - Cloud の settings（foundation `functions/api/prompt-vault/settings.js`）は generation・guard・captionStyle の 3 節。pv-sync はそこへ Fran の `sync.*` キー（`sync.recent_days`・`sync.r2_limit_gb`）を足して送る
  - Fran の実物の presets には `slotOrder`・`folder`・`filename`・`childCards` があり、いまのフロントの POST /presets が作る形より広い
  - Cloud の cards は `_normalize.js` で camelCase に直して返す
- このため、J-6 の正の対照（「いまの Fran の実物」と「いまのフロントが送る本文」）だけでは、pv-sync が送る Cloud 由来の本文が通ることを保証できない

## 2. 原因 X

指示書 J-6 の対象のうち S-10 の 3 経路と S-13 の favorite・caption が、J-5 の「フロント以外の呼び出し元がある経路」に当たる。J-6 は favorite・caption を「フロントだけが呼ぶ経路」としているが、pv-sync も呼んでいる。どちらの裁定を優先するかは指示書に書かれていない。

## 3. 対策 Y（裁定を求める）

| 案 | S-10（PUT settings/cards/presets） | S-13 favorite・caption | 備考 |
|---|---|---|---|
| A（推奨） | J-6 を優先: 当たらなければ書き込まず 4xx・INVALID に残す。正の対照に **Cloud 由来の本文**（pv-sync handback が送る形）を加え、それがすべて通ることを確かめる | J-6 を優先: 0 行更新は 404・INVALID に残す | pv-sync は 2xx 以外を `counts.errors++` として記録して次へ進む（pv-sync.mjs:668-684）ので、404 の影響は記録だけ。S-10 は fail-closed で止まる |
| B | J-5 を優先: 応答を変えず、書き込みも従来どおり行い、INVALID に残すだけ | J-5 を優先: 応答を変えず記録だけ | pv#100 の「害: データ消失・保存値の破損」のうち S-10・S-13 は解消されない |
| C | J-5 を優先（記録だけ） | J-6 を優先（404） | 経路ごとに分ける折衷 |

案 A を採る場合、Cloud 由来の本文の写しをどう用意するかの指示が要る。

- A-1: PG が foundation の `.env` のトークンで Cloud の GET `/api/prompt-vault/{settings,cards,presets}` を**読み取りだけ**行い、写しを fixture にする（本番データの読み出しになる）
- A-2: PM か発注者が写しを用意する
- A-3: Worker のコード（`settings.js`・`_normalize.js`・presets の GET）から形を組み立てた合成の fixture で代える（実物ではない）

## 4. 実行可否

- 案 A: 実行可能。A-1〜A-3 のどれで正の対照を作るかの指示が要る
- 案 B・案 C: 実行可能。追加の材料は要らない

pv#101（生成・キュー）と pv#102（接続経路）は J-5 の食い違いがない（pv-sync は `/generate`・`/queue/*`・`/debug/test-api` を呼ばない）。指示書の順序（pv#98 → … → pv#103）を変えてよければ、裁定を待つ間に pv#101 から進められる。順序を変えない場合は、pv#100 の裁定を待つ。

## 5. 変更していないもの

- ai-family-foundation・ai-family-ops のコード（読み取りのみ）
- main ブランチ・Fran の稼働プロセス・pages.dev
