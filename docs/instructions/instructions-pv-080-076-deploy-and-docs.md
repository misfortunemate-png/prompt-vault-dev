# prompt-vault デプロイ経路の整理と CLAUDE.md・_STATUS.md の v6.0 様式化 作業指示書（prompt-vault v4.0.1 据え置き）
文書種別: 権威文書

作成日: 2026-09-26 ／ PM ／ 対応仕様: 本書（簡略フロー・process.md §2.2） ／ 関連Issue: pv#80 ／ pv#76 ／ 本書一枚で完結（追補なし）

## 背景

- pv#80：README の「デプロイ手順」が実態と違う（main への push で Cloudflare Pages が自動ビルドすると書いてあるが、`prompt-vault` プロジェクトは Git 連携なしで、手動配信で更新されている）。CI の `deploy-pages` ジョブ（GitHub Pages ミラー向け）は main への push のたびに失敗しており、ミラーの URL は 403
- pv#76：CLAUDE.md・_STATUS.md が devスキル v6.0 の様式になっていない。CLAUDE.md は M1〜M5 当時の API 一覧などで 245 行あり、現状（Cloudflare Worker＋pages.dev の二路構成）と食い違う記述も残っている

## PM 裁定（本書で確定）

- **GitHub Pages ミラーは廃止する。** 発注者方針（2026-09-23「今後のアプリは Cloudflare に一本化」）に従う。フロントの公開先は Cloudflare Pages（`prompt-vault-6gr.pages.dev`）だけとする
- 本番フロントへの反映は、当面いまの手動配信（`wrangler pages deploy`）を正式な手順とする。Git 連携や CI からの自動配信は本件では入れない

## 添付マニフェスト（着工前照合・必須）

| # | パス／参照 | 種別 | SHA-256 |
|---|---|---|---|
| 1 | prompt-vault-dev: docs/instructions/instructions-pv-080-076-deploy-and-docs.md（本書） | 指示書 | — |
| 2 | prompt-vault-dev#80・#76 の本文 | Issue | — |

支給物なし。

## PG運用規律（定型・全フェーズ共通）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**: PM支給物はdiffゼロで検収される。技術的整合の調整もPMへ差し戻す
3. **発注者指示による仕様外修正**: 発注者から直接指示を受けた修正は実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記する。権威文書は書き換えない
4. **着工前**: `git pull` → inspect実行（マニフェスト照合・版確認）。緑でなければ着工しない。着工確認はチャット定型②で発話する
5. **稼働設定の変更三手順**: 稼働中の共有インフラ設定（ポート・serve/funnel等）に触れる場合は、状態記録→スクリプト一本で変更→差分確認の順とする。アドホックなコマンド連打での変異は禁止（#018）

## 作業範囲

- 何を: GitHub Pages ミラー関連の撤去、README のデプロイ手順と SW キャッシュ名の整合、CLAUDE.md・_STATUS.md の v6.0 様式化
- どこで: prompt-vault-dev のみ。ai-family-foundation には触れない

## 仕様

### S-1 GitHub Pages ミラーの撤去（pv#80）

- `.github/workflows/ci.yml` の `deploy-pages` ジョブを削除する
- source-gate の `npm run build:pages` の段を削除する
- `package.json` の `build:pages`・`deploy:pages` スクリプト、`scripts/deploy-pages.mjs`、`.env.pages` を削除する
- `vite.config.js` の `VITE_BASE`／`patchPagesAssets` は base が `/` のとき何もしないので、残してもよいし消してもよい（PG 裁量。消す場合は `npm run build` の出力が変わらないことを確かめる）
- リポジトリの GitHub Pages 設定を無効にし、`gh-pages` ブランチがあれば削除する。PAT の権限で行えない場合は停止せず、報告書に「発注者操作が必要」として手順（Settings → Pages → 無効化）を書く

### S-2 README のデプロイ手順（pv#80）

- 「デプロイ手順」を実態に合わせて書き直す。最低限、次を含める
  - フロント：`npm run build` → `npx wrangler pages deploy dist --project-name=prompt-vault --branch=main`。本番 URL は `https://prompt-vault-6gr.pages.dev`。main への push では自動反映されないこと
  - Worker（ai-family-foundation）側の経路を使う変更は、Worker を先に公開すること
  - 版を上げるときは `package.json` と `public/sw.js` の `CACHE_NAME` を同じ版にそろえること
- README の「サービスワーカー」節の現在のキャッシュ名の記載も合わせる

### S-3 SW キャッシュ名の整合

- `public/sw.js` の `CACHE_NAME` を `prompt-vault-v4.0.1` にする（v4.0.1 で上げ漏れていた）。版は 4.0.1 のまま据え置く
- フロントを S-2 の手順で本番へ公開し直す

### S-4 CLAUDE.md の v6.0 様式化（pv#76）

- 次の節だけで構成する：プロジェクトの一文説明／状態確認／文書階層（厳守）／正典文書／技術スタック／テスト実行方法／規約（チャット定型を含む）
- 「状態確認」には次の3文をそのまま入れる
  - 作業開始前に `_STATUS.md`（フロントマター）と関連Issueを確認すること。
  - 作業中断時は `_STATUS.md` のフロントマターと現在地一行を更新してから終了すること。
  - 進捗の物語・対応ログは_STATUS.mdに書かない（状態の正はIssue）。
- 「規約」の末尾に PG チャット定型（着工／完了／停止）を、process.md §2.6 ②③④と同じ形で入れる：

```
【着工】<案件名>
pull: <HEAD SHA> ／ マニフェスト照合: OK ／ inspect: 緑

【完了】<案件名>
報告書: docs/reports/<報告書>.md
commit: <SHA> ／ inspect: 緑 ／ CI: <run URL または 該当なし>

【停止】<案件名> — 停止条件: <該当条件>
報告書: docs/reports/<報告書>.md（原因X・対策Y・実行可否を記載）
指示待ち
```

- 規約には、ほかに次を含める：仕様書に記載のない判断が必要な場合は停止して報告する／指示書は docs/instructions/、報告は docs/reports/ を経由する／報告前に該当指示書を読み返す／デプロイ手順は README を正とする／`docs/supplied/` は変更禁止／`NOVELAI_API_KEY` 等をハードコードしない／Issue 対応時は docs/issue-verifier.md の Issue Verifier を使う
- 現在の CLAUDE.md にある API 一覧・データ構造・画面仕様（M2〜M5 の各節、外部連携API仕様など）は**削除せず**、`docs/reference/prompt-vault-reference.md` に移し、CLAUDE.md からはそのパスを示すだけにする。移す際に内容は書き換えない（冒頭に「文書種別: 作業文書・M1〜M5 当時の参照資料。現行と異なる記述を含みうる」と一行添える）
- 技術スタックは現行の二路構成（フラン側：Node.js＋Express・tailscale serve ／ クラウド側：ai-family-foundation の Worker・D1・R2・Durable Objects＋Cloudflare Pages のフロント）を書く

### S-5 _STATUS.md の縮退（pv#76）

- 次の形だけにする（本文の完了／未解決／接続設計原則の列挙は消す。接続設計原則は `docs/reference/prompt-vault-reference.md` の末尾へ移す）

```
---
version: 4.0.1
badge: <短く>
next: <次の一手・一行>
waiting_on: <owner|pm|pg|operator|null>
---
# プロジェクトステータス

現在地: <一行>
最終更新: YYYY-MM-DD HH:MM ／ 更新者: PG
```

## 影響範囲（PM調査済み——「ここが全部だ」）

検索キーワード: `build:pages` ／ `deploy:pages` ／ `gh-pages` ／ `deploy-pages` ／ `VITE_BASE` ／ `CACHE_NAME`

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| .github/workflows/ci.yml | L39 `npm run build:pages` ／ L44〜 `deploy-pages` ジョブ | 要修正（削除） |
| package.json | L9 `build:pages` ／ L10 `deploy:pages` | 要修正（削除） |
| scripts/deploy-pages.mjs | 全体（gh-pages へ push） | 削除 |
| .env.pages | 全体 | 削除 |
| vite.config.js | L6〜L33 `patchPagesAssets` ／ L36 `VITE_BASE` | PG 裁量（残置可） |
| public/sw.js | L1 `CACHE_NAME` | 要修正 |
| README.md | L64〜L73「デプロイ手順」／ L77〜「サービスワーカー」 | 要修正 |
| CLAUDE.md | 全体 | 要修正（S-4） |
| _STATUS.md | 全体 | 要修正（S-5） |
| docs/reference/prompt-vault-reference.md | 新設（移設先） | 新設 |
| .github/workflows/docs-automerge.yml ／ issue-verifier.yml | — | 対象外 |
| scripts/inspect.mjs | 版確認 | 確認のみ（S-3 後も緑であること） |

（PGは表にない箇所を触る場合、停止条件1で報告する）

## 禁止事項

- src/ 以下のアプリのコードを変えること（S-3 の `public/sw.js` の1行を除く）
- 版（package.json の version）を変えること
- Cloudflare Pages の Git 連携や CI からの自動配信を新たに入れること
- CLAUDE.md から移す参照資料の内容を書き換えること

## 検証計画（受入基準との対応・これが検収の正になる）

| AC | 対応 | 検証項目（手順） | 手段 | 証跡様式 | negative control |
|---|---|---|---|---|---|
| AC-1 | pv#80 | マージ後の main への push で CI の全ジョブが成功し、`deploy-pages` ジョブが存在しない | CI | run URL | 有（直前の main push の run で deploy-pages が failure であることを併記） |
| AC-2 | pv#80 | リポジトリ内に `build:pages`・`deploy:pages`・`gh-pages`・`deploy-pages` への参照が残っていない（docs/ 配下の過去文書は除く） | PG 実行（grep） | 生ログ | 該当なし |
| AC-3 | pv#80 | GitHub Pages が無効・`gh-pages` ブランチが無い（できなかった場合は発注者操作の手順を報告） | PG 実行（API） | 生ログ | 該当なし |
| AC-4 | pv#80 | README のデプロイ手順どおりに実際にフロントを公開し、本番 URL の `/sw.js` の `CACHE_NAME` が `prompt-vault-v4.0.1` になっている | PG 実行（公開＋curl） | 生ログ | 有（公開前の本番 `/sw.js` が v4.0.0 であることを記録） |
| AC-5 | pv#76 | CLAUDE.md が S-4 の節構成で、状態確認の3文とチャット定型3種を含む。参照資料は docs/reference/ に移され、移設前後で本文が一致する（冒頭の一行を除く） | PG 実行（diff） | 生ログ | 該当なし |
| AC-6 | pv#76 | _STATUS.md がフロントマター（version・badge・next・waiting_on）＋現在地一行＋最終更新の形だけになっている | PG 実行 | ファイル抜粋 | 該当なし |
| AC-7 | — | `npm run build` 成功・inspect 緑・`verify:issues` 全件 PASS | PG 実行／CI | 出力・run URL | 該当なし |

- **実機系（発注者に依頼）**: なし（SW の入れ替わりは発注者の通常利用のなかで起きる）

## 完了条件

- S-1〜S-5 を実施し、フロントを公開し直した
- 検証計画の全項目を実行し、証跡を完了報告に添付済み
- inspect緑・_STATUS.md 更新（S-5 の様式で）・pull・push 実施済み

## 報告基準

報告は docs/reports/report-pv-080-076-deploy-and-docs.md に置く（AC対応表様式）。チャット発話は定型③または④のみ。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約
2. **AC対応表**: | AC | 検証項目 | 結果 | 証跡（生ログ引用 or reports/内パス） |
3. inspect結果（緑/赤と出力の添付）・CI run URL
4. 完了条件の各項に対する充足状況
5. 未完了・未検証の項目があれば列挙（#012・美化しない）
6. 発注者指示による仕様外修正があればその旨と内容
7. サーバー再起動・コミット・プッシュの実施状況
8. 発注者操作が必要な項目（GitHub Pages の無効化ができなかった場合など）

## 発令文（PMがpush後チャットへ転写する）

```
【発令】prompt-vault v4.0.1 — デプロイ経路の整理と CLAUDE.md・_STATUS.md の v6.0 様式化
作業: GitHub Pages ミラーを撤去し、README のデプロイ手順・SW キャッシュ名を実態に合わせ、CLAUDE.md・_STATUS.md を v6.0 様式にする
リポジトリ: prompt-vault-dev ／ Issue: pv#80・pv#76
手順: git pull → docs/instructions/instructions-pv-080-076-deploy-and-docs.md を読む
      → マニフェスト照合・inspect緑を確認して着工
報告先: docs/reports/report-pv-080-076-deploy-and-docs.md（AC対応表様式）
```
