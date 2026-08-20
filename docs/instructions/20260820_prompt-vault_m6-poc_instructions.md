# M6-POC 作業指示書（Claude Codeからprompt-vault API疎通テスト）
文書種別: 権威文書

作成日: 2026-08-20 ／ PM: クリーデ ／ 経緯: ローカルHTTP APIの実証。Claude Codeから別プロセスのAPIを叩く試行は初めて

## 目的

Claude Code（フラン上）からprompt-vault（同じフラン上、ポート8788、Tailscale serve経由で8445）のAPIをHTTPで叩き、疎通・生成・保存の一連が外部から実行可能であることを実証する。

**これはコードを書く工事ではない。curlコマンドを叩いて結果を報告する検証作業である。**

## 前提

- prompt-vaultサーバーがフラン上で稼働中（ポート8788）
- Tailscale serveで `https://fraine.tail204746.ts.net:8445` に公開済み
- Claude Codeはフラン上で動作している

## 作業手順

### Step 1: 疎通確認（GET）

```bash
curl -s https://fraine.tail204746.ts.net:8445/api/healthz
```

**期待**: JSON応答（version等）が返る。
**失敗パターン**: 接続拒否、SSL証明書エラー、タイムアウト。失敗時は原因と出力を記録して停止。

localhost経由も試す:
```bash
curl -s http://127.0.0.1:8788/api/healthz
```

**両方の結果を記録すること。** Tailscale経路とlocalhost経路で差があるかの確認。

### Step 2: 読み取りAPI（GET）

```bash
# カード一覧
curl -s https://fraine.tail204746.ts.net:8445/api/cards | head -c 500

# フォルダツリー
curl -s https://fraine.tail204746.ts.net:8445/api/gallery | head -c 500

# インデックス統計
curl -s https://fraine.tail204746.ts.net:8445/api/gallery/stats
```

**期待**: それぞれJSON応答。
**確認ポイント**: レスポンスヘッダにCORS関連ヘッダ（Access-Control-Allow-Origin等）があるか → `curl -sI` で確認。

```bash
curl -sI https://fraine.tail204746.ts.net:8445/api/gallery/stats | grep -i "access-control\|content-type"
```

### Step 3: 書き込みAPI（POST）

```bash
# キューにタスク追加（画像は生成しない。キューに積むだけ）
curl -s -X POST https://fraine.tail204746.ts.net:8445/api/queue/add \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"positive":"test prompt","negative":"","params":{"model":"nai-diffusion-4-5-full","width":512,"height":512,"steps":28,"scale":5,"sampler":"k_euler_ancestral","seed":12345},"folderSegments":[],"filenameSegments":[],"label":"POC test"}]}'
```

**期待**: `{ success: true, added: 1, total: N }`
**確認後**: キューをクリアする。

```bash
curl -s -X DELETE https://fraine.tail204746.ts.net:8445/api/queue/clear
```

### Step 4: 画像生成テスト（POST・実コスト発生なし）

NovelAI APIキーが.envに設定済みの場合のみ実施。**無料枠内パラメータ（512x512・28steps）で1枚だけ生成する。**

```bash
curl -s -X POST https://fraine.tail204746.ts.net:8445/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"1girl, solo, simple background, best quality","negative_prompt":"blurry, lowres","model":"nai-diffusion-4-5-full","width":512,"height":512,"steps":28,"scale":5,"sampler":"k_euler_ancestral"}' \
  | head -c 500
```

**期待**: `{ success: true, image: { filename: "...", seed: ..., width: 512, height: 512 } }`
**失敗許容**: NovelAI APIキーが未設定や無効の場合は500エラーが返る。それは正常な失敗。外部からのHTTP呼び出し自体が成功したことが重要。

**生成に成功した場合、.tmpに画像が残るので以下で削除しておく:**
```bash
# 生成成功時のみ——filenameは上のレスポンスから取得
# curl -s -X DELETE ... は不要（.tmpは放置でも次回起動時に消える）
```

### Step 5: 結果レポート

docs/reports/ にレポートを置く。以下の内容を含むこと:

| テスト | 経路 | 結果 | レスポンス（先頭200文字） |
|---|---|---|---|
| healthz | Tailscale | ✓/✗ | ... |
| healthz | localhost | ✓/✗ | ... |
| cards GET | Tailscale | ✓/✗ | ... |
| gallery GET | Tailscale | ✓/✗ | ... |
| stats GET | Tailscale | ✓/✗ | ... |
| CORSヘッダ | Tailscale | あり/なし | ... |
| queue POST | Tailscale | ✓/✗ | ... |
| generate POST | Tailscale | ✓/✗/スキップ | ... |

**判定基準**:
- Step 1〜3が全通過 → M6-POC成功。ローカルHTTP APIは既に機能している
- CORSヘッダがない → chat-pwaブラウザからの呼び出しにはCORS設定が必要（M6本工事の課題として記録）
- いずれかで失敗 → 原因を特定して記録。M6本工事の前に解消が必要
