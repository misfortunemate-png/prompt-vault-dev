# Prompt Vault — CLAUDE.md

## 文書階層

- 発注文書: ai-family-ops docs/20260817_prompt-vault_requirements_v1.1.md
- 権威文書:
  - docs/20260817_prompt-vault_spec_m1.md（M1実装仕様書）
  - docs/instructions/20260817_prompt-vault_m1_instructions.md（M1作業指示書）
  - docs/instructions/20260818_prompt-vault_m1-nw_instructions.md（NW改修指示書）
  - docs/20260819_prompt-vault_spec_m2.md（M2仕様書）
  - docs/instructions/20260819_prompt-vault_m2a_instructions.md（M2-A作業指示書）

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

## M2-A API一覧（追加分）

| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/presets | プリセット定義取得（VAULT_ROOT/presets.json） |
| POST | /api/generate | NovelAI V4.5画像生成 |
| POST | /api/save | 画像保存（.tmp→フォルダ移動） |
| GET | /api/images | フォルダ一覧＋新着8件 |
| GET | /api/images/:folder | フォルダ内画像一覧（名前順） |
| GET | /api/images/:folder/:filename | 画像本体 |
| GET | /api/images/.tmp/:filename | 一時画像本体 |

## VAULT_ROOT

- .env `VAULT_ROOT` で指定（絶対パス）
- 未設定時: /api/presets, /api/generate, /api/save, /api/images系 はすべて400
- 起動時に `VAULT_ROOT/.tmp/` と `VAULT_ROOT/presets.json`（初回のみ）を自動生成
- フォルダ構成: `VAULT_ROOT/{character}/` に画像保存。`.tmp/` に一時画像

## 認証環境変数

- `NOVELAI_TOKEN` — NovelAI Persistent API Token（生成APIで使用）
- `NOVELAI_API_KEY` — デバッグ疎通テスト用（M1から継続）
