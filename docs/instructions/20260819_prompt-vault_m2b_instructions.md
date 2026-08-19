# Prompt Vault 作業指示書（M2-B: アルバム画面）

文書種別: 権威文書
作成日: 2026-08-19 ／ PM: クリーデ ／ 対応仕様: docs/20260819_prompt-vault_spec_m2.md v1.1 §5 ／ 本書一枚で完結

## 背景

M2-A（サーバーAPI＋生成画面）が検収完了。画像配信API（GET /api/images, /api/images/:folder, /api/images/:folder/:filename）は稼働済み。M2-Bではアルバム画面（フッター「アルバム」タブ）を実装し、M2を完了する。

## 添付マニフェスト（着工前照合・必須）

| # | パス | 種別 |
|---|---|---|
| 1 | docs/20260819_prompt-vault_spec_m2.md | 仕様書（v1.1・§5が対象） |
| 2 | docs/supplied/tokens.css | デザイン規格トークン（改変禁止） |

## PG運用規律（定型）

1. 三則: ①難航→PM差し戻し ②原因判明→報告→指示待ち ③セッション外操作→事前許可
2. 着工前: `git pull` → inspect ALL GREEN
3. 完了宣言禁止: inspect緑を添えて「確認をお願いします」で止める

## 作業範囲

- 何を: アルバム画面（新着＋フォルダ一覧＋フォルダ内表示＋4象限ナビゲーション）
- なぜ: M2「最小一覧」の実装完了
- バージョン: package.json `3.2.0` に更新

## 作業手順

### 手順1: AlbumScreen.jsx 新設

`src/screens/AlbumScreen.jsx` を新設。以下の構成で実装する。

**ルート表示（path = []）**:

1. 新着欄
   - ラベル「新着」
   - `/api/images` のレスポンス `recent` 配列を4列グリッドで表示
   - 各画像は正方形（aspect-ratio: 1/1, object-fit: cover）
   - 画像の下にフォルダ名（fontSize: 小）
   - タップでそのフォルダに遷移し、該当画像をビューアで開く

2. フォルダ欄
   - ラベル「フォルダ」
   - `/api/images` のレスポンス `folders` 配列を4列グリッドで表示
   - 各フォルダはフォルダアイコン（SVG）＋件数＋名前
   - タップでフォルダ内表示に遷移

**フォルダ内表示（path = [folderName]）**:

- パンくず: `VAULT` (タップでルートに戻る) > フォルダ名
- `/api/images/:folder` のレスポンス `files` 配列を4列グリッドで表示（名前順＝サーバーがソート済み）
- 各画像は正方形（aspect-ratio: 1/1, object-fit: cover）
- 画像の下にラベル（ファイル名先頭のプリセット名部分。`_` で分割して最初の要素）
- タップで4象限ビューアを開く

**4象限ナビゲーション（viewIdx !== null）**:

全画面オーバーレイ。画面を4象限に分割し、タップ位置で操作を決定する。

| 位置 | 操作 |
|---|---|
| 左上 | 一覧に戻る（ビューア閉じる） |
| 右上 | 次のフォルダに移動（ルートのフォルダ一覧を循環） |
| 右下 | 次の画像 |
| 左下 | 前の画像 |

ビューアの構成:
- 背景: rgba(0,0,0,0.94)
- 中央: 画像（width: 75%, max-width: 320px, aspect-ratio維持。object-fit: containで表示）
- 画像下: ファイル名（小文字・薄色）
- さらに下: 現在位置（n / total）
- 四隅に半透明の操作ガイド（左上「✕ 戻る」、右上「次フォルダ ▶」、左下「◀ 前」、右下「次 ▶」）
- 象限判定: クリック座標を要素のBoundingClientRectで割り、左右（width/2）・上下（height/2）で4分割

**画像URL**: `/api/images/{folder}/{filename}` をimgのsrcに使う。一時画像は `/api/images/.tmp/{filename}`。

### 手順2: App.jsx 接続

- AlbumScreenをインポート
- activeTab === 'album' のときAlbumScreenを表示（現在のPlaceholderViewを置き換え）
- addToast propsを渡す

### 手順3: 仕上げ

- package.json version: `3.2.0`
- _STATUS.md更新（M2-B完了）
- CLAUDE.md更新（アルバム画面の記述追加）
- `npm run inspect` — ALL GREEN
- 5W1Hコミット・push

## 禁止事項

- M2-Aで実装したサーバー側APIの変更（フロントのみ）
- npm依存の追加
- docs/supplied/tokens.css の内容変更

## テスト

| 項目 | 合格基準 |
|---|---|
| 新着表示 | 保存済み画像が新着欄に表示される |
| フォルダ表示 | フォルダアイコン・件数・名前が正しい |
| フォルダ遷移 | タップでフォルダ内画像一覧（名前順）が表示 |
| パンくず | VAULTタップでルートに戻る |
| ラベル | フォルダ内画像にプリセント名ラベルが表示 |
| 4象限:左上 | ビューアが閉じる |
| 4象限:右下 | 次の画像に進む |
| 4象限:左下 | 前の画像に戻る |
| 4象限:右上 | 次のフォルダに切り替わる |
| 4列グリッド | 横4列で正方形表示 |
| build | 警告なし |
| inspect | ALL GREEN |

## 完了条件

- アルバムタブでフォルダ一覧＋新着が表示されること
- フォルダ内で画像が名前順に並び、4象限ナビで操作できること
- inspect ALL GREEN・_STATUS.md更新・5W1Hコミット
