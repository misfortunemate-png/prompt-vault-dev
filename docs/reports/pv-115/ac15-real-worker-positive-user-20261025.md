# pv#115 AC-15 実Worker・有効認証／既存暗号文の復号証跡（発注者提供）

- 記録日: 2026-10-25（JST）
- 実施者: 発注者（フランPCで `scripts/sync-auth-check.bat` を実行）
- 証跡の由来: チャットに提示されたコンソール出力からPMが必要な部分を転記。**PMがPC上で再実行したものではない**。
- 秘密値: 記録していない。トークン値・鍵値は非掲載。

## 結果（提供された原出力の重要部分）

```text
sources: {"PV_VAULT_KEY":"secrets-file","CLOUD_TOKEN":"secrets-file","CLOUD_BASE":"default","secretsFile":"D:\\AI\\secrets\\secrets.env"} token length: 8 cloudBase: https://ai-family-foundation.misfortunemate.workers.dev
GET /sync/images?limit=1 → 200
GET /sync/r2-usage → 200 totalBytes=908374610
cloud images total: 590
decrypt thumb f8991a56aa2b9dba: OK (keyId=v1, 10626 bytes)
VERDICT PASS
```

## PM判定（AC-15）

- 実Workerによる一覧GETと容量GETが200: **正規認証成功のpositive controlを確認**。同時に、PG報告の401（トークンなし・ダミー）をnegative controlとして併用。
- `decrypt thumb ... OK`: クラウド上の既存暗号文を登録された `PV_VAULT_KEY` で復号できるという**実際の復号成功行を確認**。
- `VERDICT PASS`のみを根拠にはしない。既存スクリプトには「画像ゼロ／暗号文取得失敗でもPASSになり得る」欠陥があるが、今回の出力では実際に復号OKがあるためこの実行の成功を妨げない。欠陥は後続Issueで独立是正。
- コンソール冒頭にWindowsバッチの日本語コメント文字化け起因とみられる「内部コマンド...認識されていません」が出た。検証本体のNode処理とHTTP応答は後続行で成功。バッチの修正も別Issueで管理。
- **未検証／本ACと区別**: 実WorkerへのPUT・R2/D1反映、Cloudflare Pages配信、Pixel実機確認。実機確認・配信は発注者裁定により#115の検収前提としない。PUTの実稼働確認は運用段階で記録する。

参照: `docs/reports/report-pv-115-cloud-sync.md`、`docs/reports/pv-115/ac15-real-worker-negative.log`、`docs/reports/pv-115/ac15-real-worker-e2e.log`。
