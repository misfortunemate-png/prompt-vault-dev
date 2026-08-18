# Prompt Vault M2 仕様書 v1.0

文書種別: 権威文書
作成日: 2026-08-19 ／ PM: クリーデ ／ 承認: 未 ／ 根拠: 要件定義v1.3 R-2（単発生成）・R-3（保管）・R-4（最小一覧）

## §1 スコープ

M2 = 単発生成 → フラット保存 → 最小一覧。

- In: NovelAI API V4.5対応の単発生成、パラメータUI、無料枠ガード、VAULT_ROOTへのフラット保存、「アルバム」タブの最小一覧
- Out: カード合成（M3）、パスセグメント規則保存（M3）、ギャラリー本装（M4）、ジョブキュー（M5）、サムネイルキャッシュ（M4）

## §2 生成画面（フッター「生成」タブ）

### §2.1 レイアウト

- プロンプト入力欄（正・テキストエリア・複数行）
- ネガティブプロンプト入力欄（テキストエリア・折りたたみ可・既定開）
- パラメータセクション（折りたたみ可・既定閉）:
  - モデル選択: セレクトボックス。選択肢は §3.1 参照
  - 解像度プリセット: セレクトボックス。選択肢は §2.2 参照
  - ステップ数: 数値入力（既定28・1〜50）
  - プロンプトガイダンス（scale）: 数値入力（既定5・1〜10・0.1刻み）
  - サンプラー: セレクトボックス（既定 `k_euler_ancestral`）
  - シード: 数値入力（空欄=ランダム）
- 生成ボタン（画面下部固定）
- 結果表示エリア（生成ボタンの上に最後の生成結果を表示）

### §2.2 解像度プリセット

Opus無料枠条件: 合計ピクセル数 ≤ 1,048,576（1MP）。プリセットはすべてこの範囲内。

| 名称 | 幅 | 高さ | 用途 |
|---|---|---|---|
| Portrait（既定） | 832 | 1216 | 縦長・標準 |
| Landscape | 1216 | 832 | 横長 |
| Square | 1024 | 1024 | 正方形 |
| Wide Portrait | 768 | 1344 | 細長縦 |
| Wide Landscape | 1344 | 768 | 細長横 |

カスタム入力は置かない（枠外サイズでAnlasを消費するリスクを構造的に排除）。

### §2.3 無料枠ガード

生成リクエスト前に以下を機械チェック。違反時は生成を阻止しトーストで通知。
- 解像度: プリセット強制のため違反は起こらない
- ステップ: > 28 の場合「Anlas消費」警告を表示し、続行/キャンセルを選択させる
- n_samples: 常に1（UIに露出しない）
- action: 常に `generate`（txt2imgのみ）

### §2.4 生成中UI

- 生成ボタンをスピナー付き「生成中…」に変更、再押下不可
- エラー時: トースト通知 + 生成ボタン復帰
- 成功時: 結果表示エリアに画像表示 + 生成ボタン復帰

## §3 NovelAI APIアダプター（server側）

### §3.1 対応モデル

| 表示名 | API文字列 | 備考 |
|---|---|---|
| V4.5 Full（既定） | `nai-diffusion-4-5-full` | 最新・フルデータセット |
| V4.5 Curated | `nai-diffusion-4-5-curated` | 最新・キュレーション |
| V4 Full | `nai-diffusion-4-full` | 前世代 |
| V3 | `nai-diffusion-3` | 旧モデル（レガシー互換） |

### §3.2 APIリクエスト構造

エンドポイント: `POST https://image.novelai.net/ai/generate-image`
認証: `Authorization: Bearer {NOVELAI_TOKEN}`

V4/V4.5モデルのリクエストボディ:

```json
{
  "input": "{positive_prompt}",
  "model": "{model_string}",
  "action": "generate",
  "parameters": {
    "params_version": 3,
    "width": 832,
    "height": 1216,
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
      "caption": {
        "base_caption": "{positive_prompt}",
        "char_captions": []
      },
      "use_coords": false,
      "use_order": true
    },
    "v4_negative_prompt": {
      "caption": {
        "base_caption": "{negative_prompt}",
        "char_captions": []
      }
    },
    "negative_prompt": "{negative_prompt}"
  }
}
```

V3モデルのリクエストボディ（レガシー互換）:

```json
{
  "input": "{positive_prompt}",
  "model": "nai-diffusion-3",
  "action": "generate",
  "parameters": {
    "width": 832,
    "height": 1216,
    "scale": 5,
    "sampler": "k_euler",
    "steps": 28,
    "seed": 0,
    "n_samples": 1,
    "cfg_rescale": 0,
    "noise_schedule": "karras",
    "negative_prompt": "{negative_prompt}"
  }
}
```

モデル文字列が `nai-diffusion-3` のときはV3形式、それ以外はV4形式で送信する。分岐はサーバー側アダプターが行う。

### §3.3 レスポンス処理

- レスポンスはZIP形式（`application/zip` or `application/x-zip-compressed`）
- chat-pwa novelai.jsのZIP手動パーサー（PK\x03\x04ヘッダー走査・deflate展開・bit3データデスクリプタ対応）を移植する。npm依存追加なし
- ZIP内のPNGを1枚取り出して保存

### §3.4 APIルート

`POST /api/generate` — 生成リクエスト

リクエストボディ:
```json
{
  "prompt": "1girl, ...",
  "negative_prompt": "worst quality, ...",
  "model": "nai-diffusion-4-5-full",
  "width": 832,
  "height": 1216,
  "steps": 28,
  "scale": 5,
  "sampler": "k_euler_ancestral",
  "seed": null
}
```

レスポンス（成功）:
```json
{
  "success": true,
  "image": {
    "filename": "20260819_143052_a1b2c3d4.png",
    "path": "20260819_143052_a1b2c3d4.png",
    "size": 1234567,
    "width": 832,
    "height": 1216
  }
}
```

`seed: null` の場合はサーバー側でランダム生成（`crypto.randomInt(0, 2**32)`）し、レスポンスに含める。

### §3.5 エラー処理

- NOVELAI_TOKEN未設定 → 400 + メッセージ
- NovelAI API 4xx/5xx → エラーテキスト先頭200文字をログ、クライアントへは丸めたメッセージ
- ZIP内にPNG未検出 → 500 + メッセージ

## §4 保存（M2暫定・フラット方式）

### §4.1 保存先

`VAULT_ROOT`（.env指定・必須）。VAULT_ROOT未設定の場合、生成ボタンを無効化し設定画面への誘導メッセージを表示。

### §4.2 ファイル名

`{YYYYMMDD}_{HHmmss}_{ランダム8hex}.png`

例: `20260819_143052_a1b2c3d4.png`

M2ではVAULT_ROOT直下にフラット配置。パスセグメント（作品/キャラ/衣装）によるフォルダ構成はM3で導入する。

### §4.3 メタデータ

NovelAI APIレスポンスのPNGにはExifチャンクとして生成パラメータが埋め込まれている（NovelAI標準仕様）。M2ではこの埋め込みをそのまま保存する（上書き・除去しない）。

## §5 最小一覧（フッター「アルバム」タブ）

### §5.1 表示内容

- VAULT_ROOT内のPNGファイルを更新日時の降順で一覧表示
- 表示方式: グリッド（横2列・レスポンシブ）
- 画像の読み込み: `GET /api/images/:filename`（サーバー側でVAULT_ROOTから読み出し）
- サムネイルは生成しない（M4のsharpサムネイルまではブラウザリサイズで代替）。`loading="lazy"` で遅延読み込み
- 画像タップ → 簡易ビューア（画像の拡大表示・閉じるボタン。本格ビューアはM4）

### §5.2 画像配信API

- `GET /api/images` — ファイル一覧（ファイル名・サイズ・更新日時）
- `GET /api/images/:filename` — 画像本体（Content-Type: image/png）

一覧取得時にVAULT_ROOTを `fs.readdir` → `.png` フィルタ → `stat` で更新日時取得 → 降順ソート。M4のインデックス（ハッシュベース中央DB）導入までの暫定。

### §5.3 上限

M2時点ではページネーションを置かない。ファイル数が少ない段階（数十〜百枚）を想定。M4でインデックス＋サムネイル＋ページネーションが入る。

## §6 設定画面拡張

M1の設定画面に以下を追加:

- VAULT_ROOT表示（読み取り専用・.envから取得）
- 既定モデル選択（§3.1の選択肢。設定保存で永続化）
- NOVELAI_TOKEN状態表示（設定済み/未設定。値はマスク。.env管理）
- 既定ネガティブプロンプト（テキストエリア。生成画面の初期値に使用。既定値: `blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration`）

## §7 API一覧（M2追加分）

| メソッド | パス | 用途 |
|---|---|---|
| POST | /api/generate | 画像生成 |
| GET | /api/images | 画像一覧 |
| GET | /api/images/:filename | 画像本体 |

## §8 テスト方針

### PG自己完結

| 項目 | 手順 | 合格基準 |
|---|---|---|
| API疎通 | デバッグ画面のNovelAIテスト | 200応答 |
| 単発生成 | 生成タブでプロンプト入力→生成 | 画像表示・VAULT_ROOTにPNG保存 |
| V4.5リクエスト | V4.5 Fullで生成、サーバーログでリクエスト構造確認 | v4_prompt構造が含まれること |
| V3フォールバック | V3モデル選択→生成 | v4_prompt構造が含まれないこと |
| 無料枠ガード | ステップ数29に設定→生成 | Anlas警告が表示されること |
| VAULT_ROOT未設定 | .envからVAULT_ROOT削除→再起動 | 生成ボタン無効・誘導メッセージ |
| 一覧表示 | アルバムタブ表示 | 生成した画像がグリッド表示 |
| 簡易ビューア | 一覧の画像タップ | 拡大表示・閉じるで一覧に戻る |
| build | `npm run build` | 警告なし |
| inspect | `npm run inspect` | ALL GREEN |

### 実機（発注者に依頼）

- Pixel 10から `https://fraine.tail204746.ts.net:8445/` で生成→保存→一覧の一連動作
- 生成画像の品質確認（V4.5 vs V3の比較）

## §9 .env追加項目

```
NOVELAI_TOKEN=    # NovelAI Persistent API Token（pst-から始まる）
VAULT_ROOT=       # 画像保存ルートディレクトリの絶対パス（例: D:\AI\vault）
```

## 改訂履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-08-19 | v1.0 | 初版（PM起草） |
