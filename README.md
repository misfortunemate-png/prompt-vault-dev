# prompt-vault-dev

NovelAI 用プロンプト管理 PWA（フロントエンド + フランサーバー）。

---

## 公式 URL

| 用途 | URL |
|------|-----|
| **本番（Cloudflare Pages）** | https://prompt-vault-6gr.pages.dev |
| GitHub Pages ミラー | https://misfortunemate-png.github.io/prompt-vault-dev/ |

### ⚠ ハッシュ URL について

`wrangler pages deploy` 実行時やプレビュービルド時に次のような URL が生成される場合がある。

```
https://3f6c5a34.prompt-vault-6gr.pages.dev
```

これは **一時的なプレビュー URL** であり、正式な URL ではない。ブックマークしないこと。  
本番 URL は常に `https://prompt-vault-6gr.pages.dev` を使用すること。

---

## フランサーバー（ローカル）

フランサーバー（`server.js`）は Tailscale 経由で外部公開される。

- 起動: `npm run dev`（`D:\AI\github\prompt-vault-dev` 内）
- Tailscale エンドポイント: `https://fraine.tail204746.ts.net:8445`

### CORS ポリシー

`server.js` は以下のオリジンを許可する。

1. `.env` の `ALLOWED_ORIGINS` に列挙されたオリジン（カンマ区切り）
2. `*.prompt-vault-6gr.pages.dev` に一致するすべてのオリジン（正規表現で自動許可）

`.env` または `server.js` を変更した場合は **フランサーバーを再起動** すること（変更は起動時のみ読み込まれる）。

現在の `.env` 設定:

```
ALLOWED_ORIGINS=https://misfortunemate-png.github.io,https://prompt-vault-6gr.pages.dev
```

---

## 初期設定（サイトデータをクリアした後など）

設定画面（歯車アイコン）から以下を再入力する。

| 設定項目 | 値 |
|----------|-----|
| Cloud URL | `https://ai-family-foundation.shogosakamoto.workers.dev` |
| Token | （管理者に確認） |
| Vault Key | （管理者に確認） |

---

## デプロイ手順

本番への反映は **Git push** が確実。

```bash
git push origin main
```

Cloudflare Pages は `main` ブランチへの push を検知して自動ビルド・デプロイを行う。  
`wrangler pages deploy` を直接実行した場合はハッシュ URL にのみ反映され、`prompt-vault-6gr.pages.dev` が更新されないことがある。

---

## サービスワーカー

`public/sw.js` のキャッシュ名を変更すると古い SW が強制的に入れ替わる。

- 現在のキャッシュ名: `prompt-vault-v4.0.0`
- クロスオリジンリクエスト（フランサーバー等）は SW が傍受しない（same-origin ガード適用済み）
