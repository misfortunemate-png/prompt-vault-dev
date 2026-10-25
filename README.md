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

### クラウド同期（pv#115）

設定画面の「クラウド同期」（Fran 接続時のみ表示）で最上位フォルダを選び、「同期」を押すと、選んだフォルダ（子フォルダを含む）の画像を表示用 WebP（原寸・品質80）とサムネイル（長辺320px）にして、vault 鍵で暗号化してクラウドへ送る。手動のみ。クラウド側の画像は消さない。

- 必要な秘密: `PV_VAULT_KEY`（設定画面の vault 鍵と同じ base64 の 32 バイト鍵）・`CLOUD_TOKEN`（Worker の入口照合を通るトークン）。`CLOUD_BASE` は省略時 `https://ai-family-foundation.misfortunemate.workers.dev`
- 置き場所: `D:\AI\secrets\secrets.env`（`PV_SYNC_SECRETS_PATH` で変更可）。`server/sync.js` がこの 3 キーだけを同期開始のたびに読む（環境変数が優先）。置いた後の再起動は不要
- 秘密がなくてもフランは通常どおり起動する。同期ボタンは 503（理由を表示）
- ランタイムデータ: `data/sync.json`（選んだフォルダ）・`data/sync-webp-state.json`（WebP の送信に成功した hash）。どちらも設定画面の保存では消えない
- 検査: `scripts/verify-sync.bat`（`npm run verify:issues -- pv#115`。モックの Worker を使い、実クラウドには触れない）

---

## 初期設定（サイトデータをクリアした後など）

設定画面（歯車アイコン）から以下を入力する。

> **Cloud URL・Fran URL はアプリが管理する固定エンドポイント（read-only）。ユーザーが手入力するのは以下の 2 項目のみ。**

| 設定項目 | 値 |
|----------|-----|
| Cloud Token | （管理者に確認） |
| Vault Key | （管理者に確認） |

---

## デプロイ手順

フロントの公開先は Cloudflare Pages（プロジェクト `prompt-vault`）だけ。本番 URL は `https://prompt-vault-6gr.pages.dev`。

```bash
npm run build
npx wrangler pages deploy dist --project-name=prompt-vault --branch=main
```

- `main` への push では本番に**自動反映されない**（Git 連携なし）。反映は上の手動配信で行う
- Worker（ai-family-foundation）側の経路を使う変更は、**Worker を先に公開**してからフロントを公開する
- 版を上げるときは `package.json` の `version` と `public/sw.js` の `CACHE_NAME` を同じ版にそろえる

---

## サービスワーカー

`public/sw.js` のキャッシュ名を変更すると古い SW が強制的に入れ替わる。

- 現在のキャッシュ名: `prompt-vault-v4.2.0`
- クロスオリジンリクエスト（フランサーバー等）は SW が傍受しない（same-origin ガード適用済み）
