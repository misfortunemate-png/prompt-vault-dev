# Prompt Vault — CLAUDE.md

NovelAI の画像生成プロンプトをカード・プリセットで組み立て、生成・保存・閲覧する PWA。

## 状態確認

- 作業開始前に `_STATUS.md`（フロントマター）と関連Issueを確認すること。
- 作業中断時は `_STATUS.md` のフロントマターと現在地一行を更新してから終了すること。
- 進捗の物語・対応ログは_STATUS.mdに書かない（状態の正はIssue）。

## 文書階層（厳守）

交換所の文書には優越関係がある。冒頭の記載（文書種別）で識別する。

- **発注文書**（PMも逸脱できない）: ai-family-ops docs/ に格納
- **権威文書**（PGは編集できない）: 仕様書（docs/*spec*.md）・指示書（docs/instructions/）
- **作業文書**（共同編集可）: docs/reports/・docs/reference/
- **コード類**（PG自由編集）: src/・server/・scripts/・tests/
- 矛盾がある場合は上位文書に従う。権威文書の改変が必要な場合は docs/reports/ で差し戻す

## 正典文書

- 発注文書: ai-family-ops docs/20260817_prompt-vault_requirements_v1.3.md
- 権威文書:
  - docs/20260817_prompt-vault_spec_m1.md（M1実装仕様書）
  - docs/instructions/20260817_prompt-vault_m1_instructions.md（M1作業指示書）
  - docs/instructions/20260818_prompt-vault_m1-nw_instructions.md（NW改修指示書）
  - docs/20260819_prompt-vault_spec_m2.md（M2仕様書）
  - docs/instructions/20260819_prompt-vault_m2a_instructions.md（M2-A作業指示書）
  - docs/20260819_prompt-vault_spec_m3.md（M3仕様書）
  - docs/instructions/20260819_prompt-vault_m3_instructions.md（M3作業指示書）
  - 以後の案件は docs/instructions/ の各指示書
- 参照資料（M1〜M5 当時の API 一覧・データ構造・画面仕様・外部連携API仕様・接続設計原則）: docs/reference/prompt-vault-reference.md
- デプロイ手順: README.md「デプロイ手順」

## 技術スタック

二路構成。フロントは接続先（fran ／ cloud）を切り替えて同じ画面を使う。

- **フラン側**: Node.js + Express（server.js・server/）＋ better-sqlite3 ＋ sharp。tailscale serve（tailnet 専用）で配信
- **クラウド側**: ai-family-foundation の Cloudflare Worker（`/api/prompt-vault/*`）・D1・R2・Durable Objects（PvQueue）
- **フロント**: Vite + React（SPA・PWA）。Cloudflare Pages（`prompt-vault-6gr.pages.dev`）へ手動配信

## テスト実行方法

- `npm run inspect` — 検査（マニフェスト照合・版確認・_STATUS.md 行数・ビルド）
- `npm run verify:issues` — Issue Verifier（tests/issues/）全件
- `npm run build` — 本番ビルド
- `npm run dev` — 開発サーバー起動（Vite HMR 統合）

## 規約

- 仕様書に記載のない判断が必要な場合は停止して報告する
- 指示書は docs/instructions/、報告は docs/reports/ を経由する
- 報告前に該当指示書を読み返す
- デプロイ手順は README を正とする
- `docs/supplied/` 配下は支給物。変更禁止
- `NOVELAI_API_KEY` 等の鍵・トークンをソースコードや .env.example にハードコードしない
- Issue 対応時は docs/issue-verifier.md の Issue Verifier を使う
- base URL はルート `/`。React Router 不使用（画面遷移は useState）。フラン側のポートは 8789（.env PORT で変更可能）
- チャット発話は次の定型のみ：

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
