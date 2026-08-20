# prompt-vault M6 実装仕様書
文書種別: 権威文書

作成日: 2026-08-20
PM: クリーデ（技術顧問席・Fable）
承認済み要件定義: ai-family-ops docs/20260817_prompt-vault_requirements_v1.3.md — R-6
対応POC: docs/reports/20260820_m6-poc_report.md（疎通確認済み）

## 1. 概要

- 何を作るか: prompt-vaultの画像生成機能をchat-pwaから呼び出せるようにする最小の接続面
- なぜ作るか: R-6「ローカルHTTP API（chat-pwaからのlocalhost呼び出し想定の最小面）」の実装。自作APIとLLMの接続の学習基盤。将来のLLM主導動的生成への配線
- 誰が使うか: chat-pwaのペルソナ（LLMがfunction callingで呼ぶ）

## 2. 設計判断

### §2.1 ツール数の制限 — 1ツール原則

RAGシステムでの教訓: ツールが多いとLLMの挙動が分散し不安定になる。chat-pwa側にはLLMが呼べるツールを**1つだけ**定義する。

- `generate_image` — 生プロンプトで画像を1枚生成し、結果を返す
- healthzはツールにしない。障害時の内部切り分けロジックとして使う

### §2.2 呼び出し経路 — サーバーサイドプロキシ

chat-pwaサーバー（Node.js）がprompt-vaultのAPIをサーバー間通信（`http://localhost:8789`）で呼ぶ。ブラウザからprompt-vaultへの直接アクセスは発生しない。

**この経路を選ぶ理由:**
1. CORSミドルウェアが不要（実装が単純）
2. prompt-vaultのAPI面が外部に露出しない
3. 将来のLLM主導生成でもツール経路はサーバー間通信なので構造が一貫

**帰結:** prompt-vault側にCORS関連の変更は行わない。

### §2.3 画像の表示経路

生成結果の画像をPixelブラウザに表示する経路もサーバーサイドプロキシを通す。chat-pwaサーバーに画像プロキシエンドポイントを設け、ブラウザはchat-pwaのオリジンから画像を取得する。

### §2.4 将来拡張への備え

LLM主導で動的にプロンプトを変えながら連続生成する用途は、M6では実装しない。ただし以下を構造として確保する:

- ツール定義の追加でカード・プリセット読取やキュー操作を拡張できること（prompt-vault側のAPIは既に全て存在する）
- chat-pwaサーバーのプロキシ層にエンドポイントを足すだけで拡張できること

## 3. prompt-vault側の変更

### §3.1 変更なし

M6ではprompt-vault側のコード変更は不要。既存の以下のエンドポイントをそのまま使用する:

| メソッド | パス | 役割 |
|---|---|---|
| GET | `/api/healthz` | 疎通確認（chat-pwaサーバーの内部切り分け用） |
| POST | `/api/generate` | 画像生成 |
| GET | `/api/images/.tmp/:filename` | 一時画像の取得 |

### §3.2 API仕様ドキュメント

CLAUDE.mdの末尾に「外部連携API仕様」セクションを追記する。記載内容:

- 外部プロセスが使う3エンドポイントのリクエスト・レスポンス仕様
- generateのリクエストボディ（必須: prompt。任意: negative_prompt, model, width, height, steps, scale, sampler, seed）
- generateのレスポンス（success, image: { filename, seed, width, height }）
- 画像取得のURL構成（`/api/images/.tmp/{filename}`）
- エラーレスポンス形式（`{ error: string }`）

## 4. chat-pwa側の変更

### §4.1 プロキシエンドポイント（chat-pwaサーバー）

chat-pwaのExpressサーバーに以下を追加:

| メソッド | パス | 内部動作 |
|---|---|---|
| POST | `/api/vault/generate` | `http://localhost:8789/api/generate` へプロキシ |
| GET | `/api/vault/images/.tmp/:filename` | `http://localhost:8789/api/images/.tmp/:filename` へプロキシ |

プロキシの実装方針:
- fetchベースの単純プロキシ（ライブラリ不使用）
- prompt-vaultが応答しない場合は `http://localhost:8789/api/healthz` を叩いて原因切り分け
- エラー時はLLMに返すメッセージを人間可読な形で構成（例: 「prompt-vaultが停止しています」「生成に失敗しました: {理由}」）

### §4.2 ツール定義（chat-pwaのtools配列）

LLMに提示するツールは1つのみ:

```json
{
  "name": "generate_image",
  "description": "NovelAIで画像を1枚生成する。生プロンプト（danbooru tag形式）を渡すと画像を生成し、結果を返す。生成には10〜30秒かかる。",
  "input_schema": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "正プロンプト（danbooru tag形式、カンマ区切り）"
      },
      "negative_prompt": {
        "type": "string",
        "description": "負プロンプト（省略時はサーバー既定値）"
      }
    },
    "required": ["prompt"]
  }
}
```

ツール実行の内部フロー:
1. `POST /api/vault/generate` を呼ぶ（prompt, negative_promptを転送）
2. 成功時: 画像URL（`/api/vault/images/.tmp/{filename}`）・seed・サイズを返す
3. 失敗時: healthzで切り分け→エラーメッセージを返す
4. LLMが結果を受けて次の発話を組み立てる

### §4.3 画像の表示

ツール結果に含まれる画像URLを、chat-pwaフロントのチャット表示に`<img>`として埋め込む。実装の詳細はchat-pwa側の既存メッセージレンダリングに準じる（本仕様では規定しない）。

### §4.4 ツール提示の制御

generate_imageツールはchat-pwaの既存のツール提示制御（getToolsのcontext分岐）に従い、適切なコンテキストでのみLLMに提示する。常時提示するか特定条件でのみ提示するかはchat-pwa側の設計判断とする。

## 5. テスト方針

| # | テスト対象 | 方法 | 合格条件 |
|---|---|---|---|
| 1 | プロキシ疎通 | chat-pwaサーバーから`/api/vault/generate`を叩く | 画像が生成され、filenameとseedが返る |
| 2 | 画像プロキシ | 生成結果のfilenameで`/api/vault/images/.tmp/{filename}`を取得 | PNG画像バイナリが返る |
| 3 | ツール実行 | chat-pwaのペルソナに「絵を描いて」と指示 | generate_imageが呼ばれ、画像が表示される |
| 4 | 障害切り分け | prompt-vault停止中に生成を試みる | 「prompt-vaultが停止しています」相当のメッセージが返る |
| 5 | 実機（発注者） | Pixel 10からchat-pwaペルソナに画像生成を依頼 | 画像が表示される |

テスト1〜4はPG自己完結。テスト5は発注者による実機確認。

## 6. 作業範囲の整理

M6は二つのリポジトリにまたがる:

| リポジトリ | 作業内容 |
|---|---|
| prompt-vault-dev | CLAUDE.mdへの外部連携API仕様追記のみ（コード変更なし） |
| chat-pwa | プロキシエンドポイント・ツール定義・画像表示 |

指示書はリポジトリごとに分けず、1枚にまとめる（chat-pwa側が主作業、prompt-vault側はドキュメント追記のみ）。

## 改訂履歴

| 日付 | 変更内容 |
|---|---|
| 2026-08-20 | 初版。POC結果を踏まえサーバーサイドプロキシ方式を採用、CORS不要の判断 |
