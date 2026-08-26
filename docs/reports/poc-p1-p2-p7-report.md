# PoC P-1・P-2・P-7 検証レポート

作成日: 2026-08-26 ／ PG: フラン ／ ブランチ: `poc/cloud-validation`

---

## P-1 結果JSON

```json
{
  "p1": {
    "success": true,
    "decompress_method": "DecompressionStream",
    "png_size_bytes": 7765,
    "meta": {
      "width": 64,
      "height": 64,
      "seed": 0,
      "model": null
    },
    "encrypt_ms": 1.3,
    "decrypt_ms": 0.41,
    "ciphertext_bytes": 7781,
    "round_trip_match": true,
    "wall_clock_total_ms": 5190,
    "errors": []
  }
}
```

## P-1 DecompressionStream 判定

**成功**。`DecompressionStream('deflate-raw')` による展開が通った。方式Bへの代替は不要。

備考: `meta.model` が `null` なのはNovelAI V4.5の最小リクエスト（steps:1）ではCommentチャンクのmodel_nameが省略されるためで、展開・解析自体は正常。

## P-2 計測値（発注者による実機計測待ち）

実機テスト手順（Pixel 10 Chrome向け）:

1. `scripts/poc/p2-thumbnail.html` をフランのローカルサーバーで配信
2. Pixel 10のChromeでアクセス
3. 1024×1536前後のPNGを1枚選択し、計測値を読む

合格基準: WebP変換1秒以内・50KB前後

## P-7 計測値（発注者による実機計測待ち）

実機テスト手順（Pixel 10 Chrome向け）:

1. `scripts/poc/p7-crypto-bench.html` をフランのローカルサーバーで配信
2. Pixel 10のChromeでアクセスするだけ（自動実行）

合格基準:
- 大サイズ (1.5MB) 暗号化: 数十ms
- 小サイズ50枚バッチ: 合計1秒以内

## 依存パッケージ

追加なし。Web標準API（DecompressionStream、Web Crypto API）のみで完結。

## コミットSHAとブランチ名

ブランチ: `poc/cloud-validation`

コミットSHA: （push後に確定）

## 合格基準チェック（P-1）

| 項目 | 結果 | 合否 |
|---|---|---|
| DecompressionStream | 成功（方式A） | ✅ |
| round_trip_match | true | ✅ |
| wall_clock_total_ms | 5190ms（60秒以内） | ✅ |
