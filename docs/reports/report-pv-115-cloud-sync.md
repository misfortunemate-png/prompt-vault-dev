# pv#115 クラウド改修 — 停止報告

文書種別: 作業文書（PG報告）
作成: 2026-10-25 ／ PG ／ 対応指示書: docs/instructions/instructions-pv-115-cloud-sync.md ／ Issue: pv#115

## 状態

**停止（着工前の影響確認で停止条件に該当）。コードは一行も変更していない。**

- pull: prompt-vault-dev `1f7cac3`、ai-family-foundation `158c3b0`（Already up to date）
- マニフェスト照合: OK（#1〜#5 すべて実在。#3 Issue は OPEN）
- inspect: 緑（ALL GREEN）
- verify:issues（着工前の基準）: `SUMMARY issues=25 gated=25 pass=458 fail=0 gated_fail=0 not_run=0 waived=4 unknown=0`

停止条件に当たるのは下の S-1〜S-3。S-4 は権威文書間の食い違いで、裁定がなくても実装はできるが、どちらに従うかを確認したい。

---

## S-1 フォルダ選択を settings.json に置くと、設定画面の保存で消える（停止条件: 仕様どおりだと問題が生じる）

**原因X**
- 仕様 §3.2・指示書 1-3 は、選択フォルダを `data/settings.json` の `sync.folders` に保存するとしている
- 既存の `PUT /api/settings`（`server.js:360-364`）は、受けた本文で settings.json を**丸ごと置き換える**（`atomicWriteJson(SETTINGS_PATH, req.body)`）
- 設定画面の保存（`src/screens/SettingsScreen.jsx:240`）は `{ generation, guard, captionStyle }` の 3 キーだけを送る
- そのため、生成設定を保存するたびに `sync.folders` が消える。同じ理由で、既存の `'sync.r2_limit_gb'`・`'sync.recent_days'` もすでに消える状態にある（R2 上限は既定値 5 で読むしかない）
- 加えて、`validateSettings`（`server/validate.js:23-27`・`62-71`）は未知のキーを拒否する。`sync` を持つ本文を PUT すると 400 になる。`server/validate.js` は影響範囲表にない

**対策Y（案）**
| 案 | 内容 | 既存への影響 |
|---|---|---|
| Y1（推奨） | 選択フォルダを別ファイル `data/sync.json`（`{ "folders": [...] }`）に保存する。R2 上限は settings.json の `'sync.r2_limit_gb'` があれば読み、なければ既定 5 | 既存エンドポイント・validate.js・設定画面の保存処理に触れない。仕様 §3.2 の保存先だけが変わる |
| Y2 | `PUT /api/settings` を「既存の値に重ねる」動作に変え、validate.js に `sync` を足す | 既存エンドポイントの変更になり、指示書の禁止事項に当たる |
| Y3 | 設定画面が GET した `sync` を保持して PUT で送り返す。validate.js に `sync` を足す | 影響範囲表にない validate.js を触る。同期設定と設定画面の保存がすれ違うと上書きしうる |

**実行可否**: Y1 なら直ちに実行できる。仕様 §3.2 の保存先の改訂（または Y1 の承認）が必要。

---

## S-2 pv-sync.mjs を消すと foundation の verifier 16 本が壊れる（停止条件: 仕様どおりだと問題が生じる）

**原因X**
- 指示書 Part 4-1・仕様 §5.2 は `ai-family-foundation/scripts/pv-sync.mjs` の削除を指示している。影響範囲表の検索10は prompt-vault-dev だけを調べていた
- foundation では次のファイルが pv-sync.mjs を参照している（`grep -rln pv-sync tests scripts`）
  - verifier 16 本: `tests/issues/foundation-001`・`008`・`009`・`034`・`131`・`134`・`135`・`138`・`139`・`140`・`141`・`142`・`143`・`144`・`146`・`148`（それぞれ `-*.mjs`）
  - fixture 2 本: `tests/issues/_pvsync-env-fixture.mjs`・`_sync-handback-fixture.mjs`
  - 共有ライブラリ: `scripts/lib/sync-lock.mjs`（参照を含む）
- 削除すると、これらの verifier は対象ファイルを読めず赤になる。そのうえ、foundation の作業ツリーには本件と無関係の未コミット変更が 10 ファイルある（`src/App.jsx`・`src/pages/chat-web/**` など。別の作業のものと思われる）。PG はこれに触れない

**対策Y（案）**
| 案 | 内容 |
|---|---|
| Y1 | pv-sync.mjs を消し、上の verifier 16 本と fixture 2 本を退役させる（削除、または waived に登録）。どれを退役させてどれを残すかは PM 裁定 |
| Y2（推奨） | 本件では pv-sync.mjs を消さない。同期がフランサーバーで動くことを確かめた後に、verifier の退役と合わせて別の便で消す |

**実行可否**: どちらも実行はできる。verifier の退役はレビュアー線の資産を消すことになるので、PM の裁定が要る。

---

## S-3 フランからクラウドへ送るときの宛先とトークン、鍵の読み込み方が決まっていない（停止条件: 仕様にない判断が必要）

**原因X**
- 指示書 1-5 のコード例は `CLOUD_BASE`・`CLOUD_TOKEN` を使っているが、指示書 1-7・仕様 §3.6 が定める環境変数は `PV_VAULT_KEY` だけ。クラウドの入口照合（family-auth、`src/worker/index.js:18,74`）を通るトークンがないと、`/sync/images`・`/sync/upload-image`・`/thumbs/{hash}` は呼べない
- どのトークンを使うかが決まっていない。`D:\AI\secrets\secrets.env` には `FA_TOKEN_MACHINE` などがある（値は見ていない）。フロントは端末に保存したトークンで呼んでいる
- 仕様 §3.6・指示書 1-1 は `PV_VAULT_KEY` を `D:\AI\secrets\secrets.env` に置くとしている。しかしフランサーバーは `npm run dev` = `node --env-file=.env server.js` で起動し（`package.json`、README「起動」）、secrets.env を読む処理はどこにもない。このままでは鍵を置いても `process.env.PV_VAULT_KEY` は空のまま

**対策Y（案）**
- 環境変数は `CLOUD_BASE`（既定 `https://ai-family-foundation.misfortunemate.workers.dev`。フロントの `CLOUD_URL` と同じ根）と `CLOUD_TOKEN` の 2 つにする。`.env.example` に空値で追記する
- トークンは `FA_TOKEN_MACHINE`（機械用と思われる）を使うか、prompt-vault 用の新しいトークンを発行するか。PM・インフラPG の裁定が要る
- secrets.env の読み込みは、`package.json` の `dev`・`start` に `--env-file-if-exists=D:/AI/secrets/secrets.env` を足す（Node v24 で使える。ファイルがなくても起動は止まらない）。または server.js の起動時に読む

**実行可否**: トークンの選択が決まれば実行できる。読み込み方は上の案で実行できる。

---

## S-4 既存の約 400 枚を WebP で上書きするかどうか、仕様の中で食い違っている（確認事項）

- 仕様 §4.2 は「同期の初回実行時、既存ハッシュと一致する画像は表示用 WebP で上書きされる」としている
- 一方、仕様 §3.4 手順1-4 と指示書 1-5 手順4 は「フランにあってクラウドにない画像」だけを送る差分としている。この差分では、クラウドにすでにある hash は送られない。よって既存の約 400 枚は暗号化 PNG のまま残る
- **PG の扱い（裁定がなければ）**: 指示書 1-5 と仕様 §3.4 のとおり、差分だけを送る（上書きしない）。上書きが要るなら、「選択フォルダの画像は、クラウドにある hash も表示用 WebP で送り直す」と裁定してほしい。送り直す場合、Worker の `upload-image` は同じ R2 キーに書いて D1 を ON CONFLICT で更新するので、Worker 側の変更は要らない

---

## 着工後に PG が決めてよいか確認したい細目（停止の理由ではない）

| # | 事項 | PG の扱い（異議がなければ） |
|---|---|---|
| N-1 | R2 容量の確認（仕様 §3.7）が指示書にない | 仕様に従って実装する。使用量 ≥ 上限ならその回の上りを全部飛ばす。使用量が取れないときは C-1 に従って記録し、上りをせずに `lastRun.errors` に理由を残す（無言で上限なしに進まない） |
| N-2 | サムネの上げ方 | 仕様 §3.4 手順7・指示書のとおり、`upload-image`（本体のみ）の後に `PUT /thumbs/{hash}` で上げる |
| N-3 | 指示書 3-2 の `generateCloudThumbnail` は存在しない | 既存の `generateAndUploadThumb`（`src/lib/thumbGen.js`）を指すものと読む |
| N-4 | B-1 の実際の箇所 | `src/components/ImageViewer.jsx` 68〜101 行（影響範囲表では「確認のみ」）。指示書 3-1 の「ビューア関連コンポーネント」に当たるので、ここを直す |
| N-5 | 選択フォルダの名前の照合 | 最上位フォルダ名の完全一致。`LIKE` の `%`・`_` を含むフォルダ名でも誤って当たらないよう、`folder = ? OR substr(folder, 1, length(?) + 1) = ? || '/'` で照合する |

---

## 指示待ちの項目

1. S-1: 選択フォルダの保存先（Y1 の別ファイルでよいか）
2. S-2: pv-sync.mjs の削除と foundation の verifier 16 本の扱い（Y1 退役か、Y2 別便か）
3. S-3: フランが使うクラウドのトークン（`FA_TOKEN_MACHINE` か新規発行か）と、secrets.env の読み込み方
4. S-4: 既存 hash を WebP で上書きするか（裁定がなければ差分だけ）
