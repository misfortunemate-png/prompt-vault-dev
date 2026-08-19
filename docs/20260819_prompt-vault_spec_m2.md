# Prompt Vault M2 仕様書 v1.1

文書種別: 権威文書
作成日: 2026-08-19 ／ PM: クリーデ ／ 承認: モックアップv4承認済み ／ 根拠: 要件定義v1.3 R-2（単発生成）・R-3（保管）・R-4（最小一覧）

## §1 スコープ

M2 = プリセット選択 → 単発生成 → 保存（フォルダ振り分け）→ アルバム閲覧。

- In: プリセット＋個別プルダウンによるプロンプト構成、NovelAI API V4.5対応の単発生成、パラメータUI、無料枠ガード、保存（第一プリセットでフォルダ振り分け）、アルバム（新着＋フォルダ＋4象限ナビ）
- Out: プリセットのCRUD UI（M3・テンプレートタブ）、ギャラリー本装（M4）、ジョブキュー（M5）、サムネイルキャッシュ（M4）

## §2 生成画面（フッター「生成」タブ）

### §2.1 レイアウト（上から下へスクロール）

1. **プリセット選択**（プルダウン）: プリセット＝正プロンプト＋ネガティブのセット
2. **個別プルダウン群**: キャラ / シチュエーション / 衣装 / その他。各プルダウンの先頭は「（なし）」。選択した値がプリセットの正プロンプトに結合される
3. **プロンプト確認・編集**（折りたたみ・既定閉）: 結合結果（正）とネガティブのテキストエリア。直接編集可
4. **パラメータ**（折りたたみ・既定閉）: §2.3参照
5. **生成ボタン**: スクロール内に配置（固定フッターにしない）
6. **生成結果一覧**: 生成ボタンの下にカードが降順に積み上がる。§2.5参照

### §2.2 プリセットデータ

M2ではプリセットをJSONファイル（`VAULT_ROOT/presets.json`）で管理する。プリセットのUI編集はM3（テンプレートタブ）で実装。M2では初期データを同梱し、手動でJSONを編集可能。

```json
{
  "presets": [
    {
      "name": "ポートレート標準",
      "positive": "portrait, upper body, looking at viewer, smile, best quality, very aesthetic",
      "negative": "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration"
    }
  ],
  "characters": ["キャラA", "キャラB"],
  "situations": ["放課後", "戦闘", "日常"],
  "outfits": ["制服", "私服", "ドレス"],
  "extras": ["雨", "夜景", "桜"]
}
```

サーバー起動時にファイルが存在しなければ初期データで生成する。

プロンプト結合ルール: `{preset.positive}, {character}, {situation}, {outfit}, {extra}`。「（なし）」の項目はスキップ。

### §2.3 パラメータ

2列グリッド配置。

| 項目 | 型 | 既定値 |
|---|---|---|
| モデル | セレクト | V4.5 Full |
| 解像度 | セレクト | Portrait (832×1216) |
| ステップ | 数値 | 28（1〜50） |
| ガイダンス（scale） | 数値 | 5（1〜10・0.1刻み） |
| サンプラー | セレクト | k_euler_ancestral |
| シード | 数値 | 空欄=ランダム |

解像度プリセット（すべて≤1MP・Opus無料枠内）:

| 名称 | 幅 | 高さ |
|---|---|---|
| Portrait（既定） | 832 | 1216 |
| Landscape | 1216 | 832 |
| Square | 1024 | 1024 |

### §2.4 無料枠ガード

- ステップ > 28: 「Anlas消費」警告、続行/キャンセル選択
- 解像度: プリセット強制のため違反は起こらない
- n_samples: 常に1（UIに露出しない）

### §2.5 生成結果カード

生成ごとに1枚のカードが追加される（降順）。カードの構成:

- 正方形サムネイル（72×72px・ブラウザリサイズ）
- パラメータ表示（解像度・seed・キャラ名/衣装名）
- **保存ボタン** → 押すと「✓ 保存済み」に変化

未保存の画像はサーバー側の一時ディレクトリ（`VAULT_ROOT/.tmp/`）に保持。保存ボタンで正式フォルダに移動。

### §2.6 生成中UI

- 生成ボタンを「生成中…」に変更、再押下不可
- エラー時: トースト通知 + ボタン復帰

## §3 NovelAI APIアダプター（server側）

### §3.1 対応モデル

| 表示名 | API文字列 |
|---|---|
| V4.5 Full（既定） | nai-diffusion-4-5-full |
| V4.5 Curated | nai-diffusion-4-5-curated |
| V4 Full | nai-diffusion-4-full |
| V3 | nai-diffusion-3 |

### §3.2 APIリクエスト構造

エンドポイント: `POST https://image.novelai.net/ai/generate-image`
認証: `Authorization: Bearer {NOVELAI_TOKEN}`

V4/V4.5リクエスト:
```json
{
  "input": "{positive}",
  "model": "{model}",
  "action": "generate",
  "parameters": {
    "params_version": 3,
    "width": 832, "height": 1216,
    "scale": 5,
    "sampler": "k_euler_ancestral",
    "steps": 28,
    "seed": 0,
    "n_samples": 1,
    "ucPreset": 0,
    "qualityToggle": true,
    "dynamic_thresholding": false,
    "cfg_rescale": 0,
    "noise_schedule": "karras",
    "legacy": false,
    "legacy_v3_extend": false,
    "use_coords": false,
    "v4_prompt": {
      "caption": { "base_caption": "{positive}", "char_captions": [] },
      "use_coords": false, "use_order": true
    },
    "v4_negative_prompt": {
      "caption": { "base_caption": "{negative}", "char_captions": [] }
    },
    "negative_prompt": "{negative}"
  }
}
```

V3リクエスト（レガシー）: `params_version`・`v4_prompt`・`v4_negative_prompt`を除外、`sampler`既定を`k_euler`にする。

モデル文字列が`nai-diffusion-3`のときV3形式、それ以外はV4形式。

### §3.3 レスポンス処理

- ZIPレスポンス（PK\x03\x04ヘッダー走査・deflate展開・bit3データデスクリプタ対応）
- chat-pwa novelai.jsのZIPパーサーを移植。npm依存追加なし
- ZIP内のPNGを1枚取り出し、一時ディレクトリ（`VAULT_ROOT/.tmp/`）に保存

### §3.4 APIルート

`POST /api/generate`:

リクエスト:
```json
{
  "prompt": "portrait, upper body, ..., キャラA, 制服",
  "negative_prompt": "blurry, lowres, ...",
  "model": "nai-diffusion-4-5-full",
  "width": 832, "height": 1216,
  "steps": 28, "scale": 5,
  "sampler": "k_euler_ancestral",
  "seed": null,
  "save_meta": { "character": "キャラA", "outfit": "制服" }
}
```

レスポンス:
```json
{
  "success": true,
  "image": {
    "filename": "tmp_1724034652_a1b2c3d4.png",
    "seed": 2847103956,
    "width": 832, "height": 1216
  }
}
```

`POST /api/save`:

リクエスト:
```json
{ "filename": "tmp_1724034652_a1b2c3d4.png", "character": "キャラA", "outfit": "制服" }
```

処理: `.tmp/{filename}` → `{character}/{outfit}_{YYYYMMDD}_{HHmmss}_{hex}.png` にリネーム移動。キャラフォルダが存在しなければ作成。

レスポンス:
```json
{ "success": true, "saved_path": "キャラA/制服_20260819_143052_a1b2.png" }
```

## §4 保存とフォルダ構成

### §4.1 VAULT_ROOT

.env `VAULT_ROOT` で指定（絶対パス・必須）。未設定時は生成ボタン無効＋設定画面誘導。

### §4.2 フォルダ構成

```
VAULT_ROOT/
  .tmp/                          ← 未保存の一時画像
  presets.json                   ← プリセット定義
  キャラA/                       ← 第一プリセット（キャラ）= フォルダ
    制服_20260818_211503_c9d0.png  ← 第二プリセット（衣装）がファイル名先頭
    制服_20260817_163045_7e8f.png
    私服_20260819_143052_a1b2.png
    私服_20260818_195722_3a4b.png
  キャラB/
    ...
  オリジナル/                    ← キャラ「（なし）」の場合のフォルダ名
    ...
```

### §4.3 ファイル名規則

`{第二プリセット}_{YYYYMMDD}_{HHmmss}_{ランダム4hex}.png`

第二プリセットは衣装 → シチュエーション → その他の優先順で最初の「（なし）」でない値を使う。すべて「（なし）」の場合は `gen` をプレフィックスにする。

名前順ソートにより、同じ第二プリセット（衣装・シチュ等）の画像がフォルダ内で自然にまとまる。

### §4.4 メタデータ

NovelAI APIレスポンスのPNG Exifチャンク（生成パラメータ埋め込み）をそのまま保存する。

## §5 アルバム画面（フッター「アルバム」タブ）

### §5.1 ルート表示

1. **新着欄**: 直近の保存画像を4列グリッドで表示（最新N件・既定8件）。各画像の下にフォルダ名
2. **フォルダ欄**: VAULT_ROOT直下のフォルダを4列グリッドで表示。フォルダアイコン＋名前＋件数

### §5.2 フォルダ内表示

- パンくず（VAULT > フォルダ名）
- 4列グリッド、名前順（=第二プリセットごとにまとまる）
- 各画像の下にラベル（第二プリセント名）

### §5.3 4象限ナビゲーション

画像タップで全画面ビューアに入る。画面を4象限に分割:

| 位置 | 操作 |
|---|---|
| 左上 | メニュー（一覧）に戻る |
| 右上 | 次のフォルダに移動 |
| 右下 | 次の画像 |
| 左下 | 前の画像 |

象限ガイドは半透明で四隅に表示。下部にファイル名と現在位置（n/total）。

### §5.4 画像配信API

- `GET /api/images` — フォルダ一覧 + 新着
- `GET /api/images/:folder` — フォルダ内画像一覧（名前順）
- `GET /api/images/:folder/:filename` — 画像本体
- `GET /api/images/.tmp/:filename` — 一時画像本体

## §6 設定画面拡張

M1の設定画面に以下を追加:

- VAULT_ROOT表示（読み取り専用）
- NOVELAI_TOKEN状態表示（設定済み/未設定・マスク表示）
- 既定モデル選択

## §7 API一覧（M2追加分）

| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/presets | プリセット定義取得 |
| POST | /api/generate | 画像生成 |
| POST | /api/save | 画像保存（.tmp→フォルダ移動） |
| GET | /api/images | フォルダ一覧＋新着 |
| GET | /api/images/:folder | フォルダ内画像一覧（名前順） |
| GET | /api/images/:folder/:filename | 画像本体 |
| GET | /api/images/.tmp/:filename | 一時画像本体 |

## §8 テスト方針

### PG自己完結

| 項目 | 手順 | 合格基準 |
|---|---|---|
| プリセット読み込み | 起動→生成タブ | プルダウンにプリセット名が表示 |
| プロンプト結合 | キャラ・衣装選択→編集展開 | 結合結果が正しい |
| API疎通 | デバッグ画面のNovelAIテスト | 200応答 |
| V4.5生成 | V4.5 Fullで生成 | 画像表示・.tmpに保存 |
| V3生成 | V3モデル選択→生成 | v4_prompt構造なし |
| 保存 | 保存ボタン→確認 | フォルダに移動・ファイル名規則準拠 |
| 名前順 | 同一フォルダに衣装違いで複数保存→アルバム | 同じ衣装がまとまる |
| 新着 | 保存後アルバムタブ | 新着欄に表示 |
| 4象限 | ビューアで各象限タップ | 前後移動・フォルダ移動・閉じる |
| 無料枠ガード | ステップ29で生成 | 警告表示 |
| VAULT_ROOT未設定 | .envからVAULT_ROOT削除 | 生成ボタン無効 |
| build | npm run build | 警告なし |
| inspect | npm run inspect | ALL GREEN |

### 実機（発注者に依頼）

- Pixel 10から生成→保存→アルバム閲覧→4象限ナビの一連動作
- 生成画像の品質確認（V4.5 vs V3）

## §9 .env追加項目

```
NOVELAI_TOKEN=    # NovelAI Persistent API Token
VAULT_ROOT=       # 画像保存ルートディレクトリの絶対パス
```

## 改訂履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-08-19 | v1.0 | 初版（PM起草） |
| 2026-08-19 | v1.1 | モックアップv4承認を反映。プリセット＋個別プルダウン構成、生成結果カード＋保存ボタン、フォルダ振り分け（第一プリセット）、ファイル名規則（第二プリセント先頭・名前順まとまり）、新着欄、4象限ナビ、API設計改訂 |
