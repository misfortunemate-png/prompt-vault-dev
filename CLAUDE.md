# Prompt Vault — CLAUDE.md

## 文書階層

- 発注文書: ai-family-ops docs/20260817_prompt-vault_requirements_v1.1.md
- 権威文書:
  - docs/20260817_prompt-vault_spec_m1.md（M1実装仕様書）
  - docs/instructions/20260817_prompt-vault_m1_instructions.md（M1作業指示書）
  - docs/instructions/20260818_prompt-vault_m1-nw_instructions.md（NW改修指示書）
  - docs/20260819_prompt-vault_spec_m2.md（M2仕様書）
  - docs/instructions/20260819_prompt-vault_m2a_instructions.md（M2-A作業指示書）
  - docs/20260819_prompt-vault_spec_m3.md（M3仕様書）
  - docs/instructions/20260819_prompt-vault_m3_instructions.md（M3作業指示書）

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

## M3 データファイル

| ファイル | 用途 |
|---|---|
| data/cards.json | スロット＋カード定義（CRUD対象） |
| data/presets.json | プリセット定義（CRUD対象） |
| docs/supplied/danbooru-filtered.csv | タグ辞書（支給物・変更禁止） |

### cards.json 構造

```json
{
  "version": 1,
  "slots": [
    { "id": "s_xxxxx", "name": "キャラクター", "order": 0, "useAsFolder": true, "useInFilename": false }
  ],
  "cards": [
    { "id": "c_xxxxx", "slotId": "s_xxxxx", "name": "キャラA", "positive": "...", "negative": "..." }
  ]
}
```

### presets.json 構造

```json
{
  "version": 1,
  "presets": [
    { "id": "p_xxxxx", "name": "標準ポートレート", "tags": ["日常"], "cards": { "s_xxxxx": "c_yyyyy" } }
  ]
}
```

## M3 API一覧

| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/cards | スロット＋カード全件取得 |
| PUT | /api/cards | スロット＋カード全件上書き（並替時） |
| POST | /api/cards/slot | スロット追加 |
| PUT | /api/cards/slot/:id | スロット更新 |
| DELETE | /api/cards/slot/:id | スロット削除（カードも削除） |
| POST | /api/cards/card | カード追加 |
| PUT | /api/cards/card/:id | カード更新 |
| DELETE | /api/cards/card/:id | カード削除 |
| POST | /api/cards/card/:id/duplicate | カード複製 |
| GET | /api/presets | プリセット全件取得（data/presets.json） |
| GET | /api/presets/tags | プリセットタグ一覧 |
| POST | /api/presets | プリセット追加 |
| PUT | /api/presets/:id | プリセット更新 |
| DELETE | /api/presets/:id | プリセット削除 |
| POST | /api/presets/:id/duplicate | プリセット複製 |
| GET | /api/tags/search?q= | danbooruタグ検索（前方一致・最大20件） |
| POST | /api/save | 画像保存（M3形式: folderSegments/filenameSegments/seed） |

## 保存API（M3形式）

リクエスト: `{ filename, seed, folderSegments: string[], filenameSegments: string[] }`
- folderSegments: useAsFolder=trueのスロットで選択されたカード名
- filenameSegments: useInFilename=trueのスロットで選択されたカード名
- ファイル名: `{filenameSegments連結}_{seed10桁}.png`
- フォルダ: `{folderSegments連結}/`（未指定時は `その他/`）

## テンプレートタブ（M3）

- `src/screens/TemplateScreen.jsx` — フッター「テンプレート」タブ
- サブナビ: カード / プリセット
- カード管理: スロット一覧 → カード一覧 → カード編集（3階層）
- スロット: ドラッグ並替え・F（useAsFolder）/N（useInFilename）チェックボックス
- カード編集: TagSuggestによるdanbooru補完
- プリセット管理: タグフィルタ → プリセット編集（スロット別カード選択＋保存先プレビュー）

## M2-Aからの継続 API

| メソッド | パス | 用途 |
|---|---|---|
| POST | /api/generate | NovelAI V4.5画像生成 |
| GET | /api/images | フォルダ一覧＋新着8件 |
| GET | /api/images/:folder | フォルダ内画像一覧（名前順） |
| GET | /api/images/:folder/:filename | 画像本体 |
| GET | /api/images/.tmp/:filename | 一時画像本体 |

## VAULT_ROOT

- .env `VAULT_ROOT` で指定（絶対パス）
- 未設定時: generate/save/images系 は400
- 起動時に `VAULT_ROOT/.tmp/` を自動生成
- M2マイグレーション: `VAULT_ROOT/presets.json` あり かつ `data/cards.json` なし → M3変換 → .bak

## アルバム画面（M2-B）

- `src/screens/AlbumScreen.jsx` — フッター「アルバム」タブ
- ルート表示: 新着（recent）+ フォルダ一覧（folders）を4列グリッド
- フォルダ内表示: 画像を4列グリッド・名前順（サーバーソート済み）
- 4象限ビューア: 全画面オーバーレイ。左上=閉じる、右上=次フォルダ、右下=次画像、左下=前画像

## 認証環境変数

- `NOVELAI_TOKEN` — NovelAI Persistent API Token（生成APIで使用）
- `NOVELAI_API_KEY` — デバッグ疎通テスト用（M1から継続）
