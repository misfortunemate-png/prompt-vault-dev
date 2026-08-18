# Prompt Vault — CLAUDE.md

## 文書階層

- 発注文書: ai-family-ops docs/20260817_prompt-vault_requirements_v1.1.md
- 権威文書:
  - docs/20260817_prompt-vault_spec_m1.md（実装仕様書）
  - docs/instructions/20260817_prompt-vault_m1_instructions.md（作業指示書）
  - docs/instructions/20260818_prompt-vault_m1-nw_instructions.md（NW改修指示書）

## 規約

- base URL はルート `/` 。ベースパスなし
- ポート 8789（.env PORT で変更可能）
- React Router 不使用。画面遷移は useState で管理
- docs/supplied/ 配下は支給物。内容変更禁止
- NOVELAI_API_KEY をソースコードや .env.example にハードコードしない

## スタック

- サーバー: Node.js + Express
- フロント: Vite + React（SPA）
- 配信: tailscale serve --https=8445（tailnet専用）

## コマンド

- `npm run dev` — 開発サーバー起動（Vite HMR 統合）
- `npm run build` — 本番ビルド
- `npm run inspect` — 検査スクリプト実行
