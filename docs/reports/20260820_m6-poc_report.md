# M6-POC 疎通テストレポート

実施日: 2026-08-20
実施者: Claude Code（フラン上）
対象: prompt-vault v3.6.0

## テスト結果

| テスト | 経路 | 結果 | レスポンス（先頭200文字） |
|---|---|---|---|
| healthz | Tailscale | ✓ | `{"status":"ok","version":"3.6.0"}` |
| healthz | localhost:8789 | ✓ | `{"status":"ok","version":"3.6.0"}` |
| healthz | localhost:8788 | ✗ | `Cannot GET /api/healthz`（別プロセスが応答） |
| cards GET | Tailscale | ✓ | `{"version":1,"slots":[{"id":"s_0f9a6","name":"シチュエーション","order":0,...}],"cards":[...]}` |
| gallery GET | Tailscale | ✓ | `{"tree":[{"name":"FGO","path":"FGO","imageCount":0,"children":[{"name":"イシュタル","path":"FGO/イシュタル","imageCount":65,...},...]},...]}` |
| stats GET | Tailscale | ✓ | `{"total":471,"folders":11,"thumbed":471}` |
| CORSヘッダ | Tailscale | なし | `Content-Type: application/json; charset=utf-8` のみ。`Access-Control-Allow-Origin` なし |
| queue POST | Tailscale | ✓ | `{"success":true,"added":1,"total":1}` → クリア済み `{"ok":true}` |
| generate POST | Tailscale | ✓ | `{"success":true,"image":{"filename":"tmp_1787212929995_ae11dac3.png","seed":3281306985,"width":512,"height":512}}` |

## 判定

**M6-POC成功。** Step 1〜3 全通過、Step 4（画像生成）も成功。

ローカルHTTP APIは外部プロセス（Claude Code）から正常に呼び出し可能であることを実証した。

## 課題

1. **CORSヘッダ未設定** — `Access-Control-Allow-Origin` が返らないため、chat-pwaブラウザからの直接呼び出しにはCORS設定の追加が必要。M6本工事の課題として記録。
2. **ポート番号の齟齬** — 指示書にはlocalhost:8788と記載されていたが、実際のprompt-vaultはポート8789で稼働。8788では別プロセス（Express系）が応答し `Cannot GET` を返した。CLAUDE.mdの記載（8789）が正。
