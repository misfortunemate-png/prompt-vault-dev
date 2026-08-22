# NAI V5対応・キャラプロンプト検証 報告書

作成日: 2026-08-22 ／ version: 3.10.0

## #1: V5モデルの追加

### 実装内容

- `src/screens/GenerateScreen.jsx` MODELS配列にV5 Full⚡ / V5 Curated⚡を追加（先頭2行）
- デフォルトモデルは`nai-diffusion-4-5-full`のまま維持（L125, L509, generate.js L19）
- `server/providers/novelai.js` に`isV5`フラグ追加。V5はV4系と同じ`v4_prompt`構造を使用するため、追加の分岐は不要（`!isV3`パスで処理）

### UI確認

- モデルプルダウンにV5 Full⚡ / V5 Curated⚡が表示されることを確認
- デフォルト選択がV4.5 Fullのままであることを確認

## #2: V5生成PoC

### 結果: 成功

- **使用モデル文字列**: `nai-diffusion-5-full`（推定値がそのまま正解）
- **HTTPステータス**: 200
- **生成画像**: 832×1216、seed=3865935728

### V5メタデータ構造の差分

V5のPNG Commentチャンクの主な差分:

| フィールド | V4.5 | V5 |
|---|---|---|
| `model` | 存在（モデル名） | **存在しない** |
| `model_name` | 存在しない | `"NovelAI Diffusion V5"` |
| `model_hash` | 存在しない | `"0ADF9AB7"` |
| `signed_hash` | 存在しない | 存在（Base64署名） |
| `quality_boost` | 存在しない | `false` |
| `straight_alpha` | 存在しない | `false` |
| `v4_prompt` | 同構造 | **同構造**（char_captions含む） |
| tEXt `Source` | `Stable Diffusion` 等 | `NovelAI Diffusion V5 0ADF9AB7` |

### 対応

- `server/png-meta.js` の `parseNovelAiChunk` に `model_name` フォールバックを追加
- `parsed.model` が存在しない場合、`parsed.model_name` を `result.model` に格納
- 修正後、V5画像で `model: "NovelAI Diffusion V5"` が正しく読めることを確認

## #3: キャラプロンプト読み取りの実機検証

### V4.5キャラプロンプト検証: 合格

- VAULT_ROOT内にchar_captions付きV4.5画像が**62枚**存在
- `parsePngMeta` でbase_caption + char_captionsが正しく結合されることを確認
- 例: base=`" motion lines, heart, sound effects, "` + char=`"trance terra branford, girl, solo, ..."` → promptに両方が含まれる

### V5キャラプロンプト検証: 合格

- V5 Fullで2キャラクター配置のテスト画像を生成（char_captions 2件）
- V5のchar_captions構造はV4.5と**完全に同一**（`v4_prompt.caption.char_captions[].char_caption`）
- parsePngMetaの読み取り結果:
  - prompt: `"best quality, 2girls, 1girl, red hair, blue eyes, smile, 1girl, blonde hair, green eyes, wink"`
  - base_caption + 2つのchar_captionが正しく結合されている
- **png-meta.jsの追加修正は不要**（V4.5用のコードがそのままV5にも対応）

## 完了条件の充足状況

| 条件 | 状態 |
|---|---|
| V5モデルがUIに表示され選択できる | ✅ |
| V5 PoCの結果が報告に明記 | ✅ 成功・モデル文字列確認済み |
| キャラプロンプト検証結果が報告に明記 | ✅ V4.5/V5ともに合格 |
| V4.5の既存機能が壊れていない | ✅ デフォルトモデル・既存パス未変更 |
| ビルド | ✅ 警告なし |
| サーバー再起動 | ✅ |
| コミット・プッシュ | ✅ |
| _STATUS.md更新 | ✅ v3.10.0 |

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/screens/GenerateScreen.jsx` | MODELS配列にV5 Full⚡ / V5 Curated⚡追加 |
| `server/providers/novelai.js` | `isV5`フラグ追加 |
| `server/png-meta.js` | `model_name`フォールバック追加 |
| `package.json` | version → 3.10.0 |
| `_STATUS.md` | v3.10.0マイルストーン追加 |
