# 文書種別: 権威文書

# prompt-vault クラウド化 PoC指示書（P-1・P-2・P-7）

作成日: 2026-08-26 ／ PM: クリーデ ／ 対応要件定義: ai-family-ops docs/prompt-vault-cloud/requirements-definition-v1.0.md ／ 本書一枚で完結（追補なし）

## 添付マニフェスト（着工前照合・必須）

本PoCは検証スクリプトの作成であり、prompt-vault-devの納品物コードには触れない。inspectは本PoCでは対象外。

| # | パス | 種別 | 備考 |
|---|---|---|---|
| 1 | .env | 環境変数 | NOVELAI_TOKEN が設定済みであること |
| 2 | server/providers/novelai.js | 参照 | NovelAI要求組立の参考（コピー元） |
| 3 | server/png-meta.js | 参照 | PNGメタ解析の参考（コピー元） |

## PG運用規律（定型・全フェーズ共通）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**: server/配下の既存コードは変更しない。参照のみ
3. **着工前**: `git pull` で最新を取得

## 作業範囲

- **何を**: クラウド化に必要な3つの技術仮説を最小スクリプトで検証する
- **なぜ**: 発注文書§11の仮説1・3・9。基礎工事着手前にリスクを潰す
- **どこで**: prompt-vault-dev（D:\AI\github\prompt-vault-dev）。PoCスクリプトは `scripts/poc/` に配置

## 作業手順

### P-1: DecompressionStream + PNGメタ解析 + 暗号化パイプライン

**検証する仮説**: NovelAI応答のZIPを `DecompressionStream('deflate-raw')` で展開でき、PNGメタ解析がNode.js crypto非依存の純JSで動き、Web Crypto API（AES-256-GCM）で暗号化できること。

**スクリプト**: `scripts/poc/p1-decompress-pipeline.mjs`

手順:
1. `.env` から `NOVELAI_TOKEN` を読む（server.jsの.envパースと同じ方式）
2. NovelAI API（`https://image.novelai.net/ai/generate-image`）に最小リクエストを送る
   - model: `nai-diffusion-4-5-curated`、64×64、steps: 1、seed: 0
   - 要求の組立は `server/providers/novelai.js` を参考にする。V4以降の `v4_prompt` 構造を使用
3. 応答バイナリ（ZIP形式）から、**`inflateRawSync` を使わずに** PNGを取り出す。以下の二方式を両方試す:
   - **方式A**: `DecompressionStream('deflate-raw')` を使う（Web Streams API）
   - **方式B**: `DecompressionStream('deflate-raw')` が失敗した場合の代替として、ZIPのcompressionフィールドが0（store/無圧縮）の場合はそのまま取り出す
4. 取り出したPNGを `server/png-meta.js` の `parsePngMeta` で解析する。ただし **`parsePngMeta` をimportするのではなく、png-meta.jsの内容をコピーしてpocスクリプト内に置く**（既存コードを変更しないため）
5. 取り出したPNGを Web Crypto API の `AES-256-GCM` で暗号化する:
   - 鍵: `crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])`
   - IV: `crypto.getRandomValues(new Uint8Array(12))`
   - 暗号化: `crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pngBuffer)`
6. 暗号文を復号し、元のPNGと一致することを確認
7. 以下を標準出力にJSON形式で出す:

```json
{
  "p1": {
    "success": true,
    "decompress_method": "DecompressionStream" or "store" or "failed",
    "png_size_bytes": 12345,
    "meta": { "width": 64, "height": 64, "seed": 0, "model": "..." },
    "encrypt_ms": 1.23,
    "decrypt_ms": 0.98,
    "ciphertext_bytes": 12400,
    "round_trip_match": true,
    "wall_clock_total_ms": 4567,
    "errors": []
  }
}
```

**注意点**:
- Node.js v24のWeb Crypto APIは `crypto.subtle` でアクセスする（`globalThis.crypto.subtle`）
- DecompressionStreamはNode.js v18+で利用可能。`import { DecompressionStream } from 'stream/web'` が必要な場合がある
- NovelAI応答のZIPはローカルファイルヘッダー（PK\x03\x04）を走査し、flags bit3（data descriptor）に対応する。`server/providers/novelai.js` の `extractFirstPngFromZip` のロジックを参考にする

### P-2: 端末サムネイル生成

**検証する仮説**: Pixelの端末側canvasでwebpサムネイルを生成し、暗号化できること。

**ファイル**: `scripts/poc/p2-thumbnail.html`

HTML一枚で完結するテストページ:
1. ファイル選択ボタン（`<input type="file" accept="image/png">`）
2. 選択されたPNGをcanvasに描画（最大幅320px、アスペクト比維持）
3. `canvas.toBlob('image/webp', 0.8)` でwebpに変換
4. webpバイナリをAES-256-GCMで暗号化
5. 暗号文を復号しBlobURLで表示（復号結果の確認）
6. 以下の計測値を画面に表示:
   - 入力PNGサイズ
   - canvas描画時間
   - webp変換時間
   - webpサイズ
   - 暗号化時間
   - 復号時間
   - 合計処理時間

**UIは最小限でよい**。計測値が読めれば合格。スタイルはprompt-vault-devのtokens.cssを参照しなくてよい（独立したテストページ）。

### P-7: 暗号化・復号のバッチ性能

**検証する仮説**: AES-GCMの暗号化・復号が1.5MB級で数十ms、50枚のサムネイルバッチで体感を損なわないこと。

**ファイル**: `scripts/poc/p7-crypto-bench.html`

HTML一枚で完結するベンチマーク:
1. ページ読み込み時に自動実行（ファイル選択不要）
2. ランダムデータで以下を計測:
   - **大サイズ**: 1.5MB × 1回（画像本体相当）
   - **小サイズバッチ**: 50KB × 50回（サムネイル一覧相当）
   - **極小バッチ**: 5KB × 100回（メタデータ相当）
3. 各パターンについて暗号化・復号の時間を計測
4. 結果を表形式で画面に表示:
   - パターン名
   - 1件あたりの暗号化時間（ms）
   - 1件あたりの復号時間（ms）
   - 合計時間（ms）
   - round_trip_match（true/false）
5. ページ下部に「Pixel 10で50枚のサムネイル表示は ○○ms」の見積もりを表示

## 禁止事項

- server/ 配下の既存ファイルの変更
- src/ 配下の既存ファイルの変更
- package.json への依存追加（Web標準APIのみで完結すること。依存が必要な場合は停止・報告）
- npm install の実行
- scripts/poc/ 以外へのファイル作成

## テスト

- **PG自己完結**: P-1のNode.jsスクリプトを実行し、JSON出力を確認
- **実機系（発注者に依頼）**: P-2・P-7のHTMLファイルをPixel 10のChromeで開き、計測値を確認

実機テストの手順（発注者向け）:
1. フラン上でP-2・P-7のHTMLをブラウザでアクセスする（`http://localhost:8789/poc/p2-thumbnail.html` 等のサーブは不要。`file://` プロトコルでWeb Crypto APIが使えない場合は、PGがpython -m http.serverで一時サーブする）
2. Pixel 10のChromeで `http://fraine.tail204746.ts.net:XXXX/p2-thumbnail.html` を開く（ポートはPGが報告）
3. P-2: prompt-vault-devの画像（1024×1536前後のPNG）を1枚選択し、計測値を読む
4. P-7: ページを開くだけ。結果が表示されるのを待つ

## 完了条件

1. `scripts/poc/p1-decompress-pipeline.mjs` が実行でき、JSON結果が出力される
2. `scripts/poc/p2-thumbnail.html` がフランのブラウザで動作する
3. `scripts/poc/p7-crypto-bench.html` がフランのブラウザで動作する
4. P-1の結果JSON・P-2/P-7のスクリーンショットをdocs/reports/に報告
5. 3ファイルをコミット・pushする（ブランチ: `poc/cloud-validation`）
6. _STATUS.mdの更新は不要（本体のマイルストーンに影響しない）

## 報告基準

報告は docs/reports/poc-p1-p2-p7-report.md に置く。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. P-1の結果JSON（そのまま貼付）
2. P-1でDecompressionStreamが成功したか、代替が必要だったか
3. P-2の計測値（入力サイズ・webpサイズ・各処理時間）
4. P-7の計測表（3パターン×暗号化/復号）
5. 依存パッケージが必要になった場合はその理由と候補
6. コミットSHAとブランチ名

### 合格基準（PM判定用）

| 項目 | 合格 | 外れた場合の次手 |
|---|---|---|
| P-1 DecompressionStream | 展開成功 | 純JS inflate実装を検討（pako等）。PMに依存追加の承認を求める |
| P-1 暗号化round trip | true | Web Crypto APIの使い方を修正 |
| P-1 全体wall clock | 60秒以内 | DO CPU時間上限の確認。画像サイズを64→実サイズに変えて再計測 |
| P-2 webp変換 | 1秒以内・50KB前後 | quality・maxWidth調整 |
| P-7 大サイズ暗号化 | 数十ms | サムネイル先行表示で本体復号を遅延 |
| P-7 小サイズ50枚 | 合計1秒以内 | 並列復号・プログレッシブ表示を検討 |
