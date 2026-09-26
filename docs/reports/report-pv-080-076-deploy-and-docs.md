# pv#80・pv#76 デプロイ経路の整理と CLAUDE.md・_STATUS.md の v6.0 様式化 — 完了報告（prompt-vault v4.0.1 据え置き）
文書種別: 作業文書

作成日: 2026-09-26 ／ PG ／ 対応指示書: docs/instructions/instructions-pv-080-076-deploy-and-docs.md ／ Issue: pv#80・pv#76 ／ commit: e55c6d1（PR #92）

## 1. 実装内容の要約

- **S-1**:
  - ci.yml から `deploy-pages` ジョブと source-gate の `npm run build:pages` を削除した
  - `package.json` の `build:pages`・`deploy:pages`、`scripts/deploy-pages.mjs`、`.env.pages` を削除した
  - `vite.config.js` は残した（PG 裁量。base が `/` のとき何もしない。変更していないので `npm run build` の出力は変わらない）
  - `gh-pages` ブランチを削除した
  - GitHub Pages の無効化は API で拒否された（§8）
- **S-2**: README の「デプロイ手順」を書き直した。内容は、手動配信の2コマンド、本番 URL、main への push では反映されないこと、Worker を先に公開すること、版と `CACHE_NAME` をそろえること。「サービスワーカー」節のキャッシュ名も v4.0.1 にした
- **S-3**: `public/sw.js` の `CACHE_NAME` を `prompt-vault-v4.0.1` にし、README の手順どおりに本番へ公開した。版（package.json）は変えていない
- **S-4**: CLAUDE.md を次の構成にした（一文説明、状態確認、文書階層（厳守）、正典文書、技術スタック、テスト実行方法、規約（チャット定型を含む））
  - 状態確認の3文とチャット定型3種は、指示書の文面どおりに入れた
  - 旧 CLAUDE.md の L23-242（スタック・コマンド・M2〜M5 の各節・認証環境変数・外部連携API仕様）は、書き換えずに `docs/reference/prompt-vault-reference.md` へ移した
  - 旧「文書階層」の文書リストは「正典文書」に、旧「規約」の項目は新しい「規約」に引き継いだ
- **S-5**: _STATUS.md を、フロントマター（version・badge・next・waiting_on）＋現在地一行＋最終更新の形にした。接続設計原則は参照資料の末尾へ移した

## 2. AC対応表

| AC | 検証項目 | 結果 | 証跡 |
|---|---|---|---|
| AC-1 | main push の CI が全ジョブ成功し、`deploy-pages` が無い | ✅ PASS（negative control あり） | 修正前（前回の main push）：`failure https://github.com/misfortunemate-png/prompt-vault-dev/actions/runs/36210234031 jobs=source-gate:success,deploy-pages:failure` ／ 修正後：`CI success https://github.com/misfortunemate-png/prompt-vault-dev/actions/runs/36211528865 jobs=source-gate:success`・`Issue Verifier success …/runs/36211528857 jobs=verify-issues:success` |
| AC-2 | `build:pages`・`deploy:pages`・`gh-pages`・`deploy-pages` への参照が残っていない（docs/ は除く） | ✅ PASS | `grep -rn "build:pages\|deploy:pages\|gh-pages\|deploy-pages" --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=dist --exclude-dir=.git --exclude-dir='.phase6b-*' .` → 出力なし `exit=1 (1=該当なし)` |
| AC-3 | GitHub Pages が無効で、`gh-pages` ブランチが無い | ✅ PASS（Pages の無効化は発注者操作。§8） | `git push origin --delete gh-pages` → `- [deleted] gh-pages`。`git ls-remote --heads origin gh-pages` → 空 ／ `gh api -X DELETE repos/misfortunemate-png/prompt-vault-dev/pages` → `{"message":"Deactivating GitHub pages for this repository is not allowed.","status":"422"}`。発注者が Settings → Pages で Branch を None にした後：`gh api repos/misfortunemate-png/prompt-vault-dev/pages` → `{"message":"Not Found","status":"404"}` ／ `https://misfortunemate-png.github.io/prompt-vault-dev/` → `HTTP 404` |
| AC-4 | README の手順で公開し、本番 `/sw.js` の `CACHE_NAME` が v4.0.1 になる | ✅ PASS（negative control あり） | 公開前：`const CACHE_NAME = 'prompt-vault-v4.0.0';` ／ `npm run build` → `npx wrangler pages deploy dist --project-name=prompt-vault --branch=main` → `✨ Deployment complete! … https://c0b834c7.prompt-vault-6gr.pages.dev` ／ 公開後：`curl https://prompt-vault-6gr.pages.dev/sw.js` → `const CACHE_NAME = 'prompt-vault-v4.0.1';` |
| AC-5 | CLAUDE.md が S-4 の構成で、3文と定型3種を含む。移設前後で本文が一致する | ✅ PASS | 節：`## 状態確認` `## 文書階層（厳守）` `## 正典文書` `## 技術スタック` `## テスト実行方法` `## 規約`（一文説明は表題の直下）。移設の照合：旧 CLAUDE.md L23-242 と参照資料 L4-223 の `diff` → `IDENTICAL`（冒頭の表題・文書種別の2行と、末尾に移した接続設計原則は照合の範囲外） |
| AC-6 | _STATUS.md がフロントマター＋現在地一行＋最終更新だけ | ✅ PASS | 抜粋：`version: 4.0.1` ／ `badge: デプロイ経路を Cloudflare Pages に一本化・CLAUDE.md v6.0 様式化（pv#80・pv#76）` ／ `next: PM検収（pv#80・pv#76）／ 発注者実機確認（pv#81 AC-3/4/6/7）` ／ `waiting_on: pm` ／ `# プロジェクトステータス` ／ `現在地: pv#80・pv#76 実施済み、PM 検収待ち` ／ `最終更新: 2026-09-26 11:30 ／ 更新者: PG` |
| AC-7 | `npm run build` 成功・inspect 緑・`verify:issues` 全件 PASS | ✅ PASS | `✓ built in 658ms` ／ inspect `=== ALL GREEN ===` ／ `SUMMARY issues=17 gated=17 pass=89 fail=0 gated_fail=0 not_run=0 waived=4` ／ CI は AC-1 |

## 3. inspect 結果・CI

```
✅ マニフェスト照合
✅ 支給物SHA-256照合
✅ 版確認
✅ _STATUS.md 行数
✅ danbooru-filtered.csv SHA-256
✅ ビルド確認
=== ALL GREEN ===
```
CI: https://github.com/misfortunemate-png/prompt-vault-dev/actions/runs/36211528865 （PR #92 では source-gate・verify-issues とも PASS）

## 4. 完了条件の充足

| 条件 | 状態 |
|---|---|
| S-1〜S-5 を実施し、フロントを公開し直した | ✅ |
| 検証計画の全項目を実行し、証跡を添付 | ✅ §2 |
| inspect 緑・_STATUS.md 更新（S-5 様式）・pull・push | ✅ |

## 5. 未完了・未検証

- SW の入れ替わり（v4.0.0 → v4.0.1）は発注者の通常利用のなかで起きる。PG は実機で確かめていない（指示書どおり、実機系なし）

## 6. 発注者指示による仕様外修正

なし

## 7. 再起動・コミット・プッシュ

- コミット e55c6d1（PR #92、squash で main に取り込み済み）。pull 済み
- 本報告は別の PR で取り込む
- サーバーの再起動はしていない（本件はフラン側のサーバーのコードに触れていない）

## 8. 発注者操作が必要な項目

**2026-09-26 発注者が実施済み（Source: Deploy from a branch ／ Branch: None）。確認結果は AC-3。**


**GitHub Pages の無効化**：PAT の権限では「Deactivating GitHub pages for this repository is not allowed.」（HTTP 422）で拒否された。手順は次のとおり。
1. https://github.com/misfortunemate-png/prompt-vault-dev/settings/pages を開く
2. 「Build and deployment」の Source が「Deploy from a branch」（gh-pages）になっているので、Branch を **None** にして Save する（または「Unpublish site」を押す）
3. 確認：`https://misfortunemate-png.github.io/prompt-vault-dev/` が 404 になること
