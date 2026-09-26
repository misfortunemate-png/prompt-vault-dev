# pv#81 生成直後の画像表示 — 停止報告（prompt-vault v4.0.1 ／ foundation v0.25.5）
文書種別: 作業文書

作成日: 2026-09-26 ／ PG ／ 対応指示書: docs/instructions/instructions-pv-081-unsaved-result-view.md ／ Issue: pv#81

## 状態: 停止（停止条件1「仕様どおりだと問題が生じる」）

## 停止理由

S-3（PM裁量で確定）は、App.jsx の「`connectionState.revision` が変わったら `setResults([])`」を見直せと指示している。
一方で AC-11 は「既存 verifier 全件 PASS（**pv#49 ほか既存含む**）」を求めている。
既存の `tests/issues/pv-049-connection-revision.mjs` L99-103 には次の検査がある。

```
'Generate result invalidation consumes the common connection revision',
/setResults\(\[\]\)[\s\S]{0,120}\[connectionState\.revision\]/.test(app),
```

これは「revision が変わると一覧を消す」実装を字面で要求しているので、S-3 と両立しない。S-3 を実装した現状の結果は次のとおり。

```
FAIL    Generate result invalidation consumes the common connection revision — Generate results are not invalidated by connection revision
SUMMARY issues=17 gated=17 pass=88 fail=1 gated_fail=1 not_run=0 waived=4
```

既存の回帰検査を PG の判断で書き換えることは、検査を通すために柵を外すことになりかねないため、ここで止めて指示を仰ぐ。

## 原因X・対策Y・実行可否

- **原因X**: pv#49 の検査が、柵の意図（「別の接続先の結果を画面に残さない」）ではなく実装の形（revision キーの `setResults([])`）を確かめている。S-3 は revision の意味（connection.js）は変えず、一覧の消去条件だけを「route＋token が変わったとき」に絞る。`cloud → offline → cloud` では revision が進むので、字面検査は落ちる
- **対策Y（推奨）**: pv#49 の当該検査1件を、意図に沿った形に差し替える。つまり、一覧の消去が `resolveResultsOwner`（route＋token の持ち主判定）経由で行われ、`cloud ↔ fran` と token の変更で消えることを確かめる。この挙動確認は pv#81 の verifier（AC-5）ですでに実行している。pv#49 の他の検査（revision の生成・API 層の古い応答の拒否・各画面の key）は変更しない
- **対策Y'（代案）**: pv#49 の当該検査を waiver にして pv#81 の AC-5 に役割を引き継ぐ
- **実行可否**: どちらも技術的にはすぐ実行できる。PM の指示を受けてから行う

## 停止時点の進捗（未コミット・未 push・未デプロイ）

| 項目 | 状態 | 証跡 |
|---|---|---|
| 着工前 pull・マニフェスト照合・inspect | OK（両リポジトリ緑。PM コメント3件の実在を確認済み） | pull: prompt-vault-dev b395917 ／ foundation e683199 |
| foundation S-1（`/queue/task/:id/data`・DO `GET /task/:id/data`・handler のルート） | 実装済み・作業ツリーのみ | — |
| foundation S-4（thumbs PUT：行が無ければ R2 に書く前に 404） | 実装済み・作業ツリーのみ | — |
| foundation verifier `tests/issues/pv-081-unsaved-result-data.mjs`（key `pv#81`） | 現行コードで赤 → 修正後に緑 | 下記 |
| foundation `verify:issues` 全件 | PASS（issues=155 pass=870 fail=0） | — |
| foundation inspect | 緑（版 0.25.5 一致。動的検査は従来どおり NOT_RUN） | — |
| prompt-vault-dev S-2・S-3・S-4（画面） | 実装済み・作業ツリーのみ | — |
| prompt-vault-dev verifier `tests/issues/pv-081-result-fetch-by-task.mjs` | 現行コードで赤 → 修正後に緑 | 下記 |
| prompt-vault-dev `verify:issues` 全件 | **pv#49 の1件が FAIL**（本停止の理由） | 上記 |
| prompt-vault-dev inspect | 版確認のみ赤：package 4.0.1 に対し公開中の healthz は 4.0.0。デプロイ後に解消する見込み | — |
| デプロイ（Worker → フロント） | 未実施 | — |

### negative control（foundation・現行 e683199）

```
FAIL    AC-1: unsaved done task → 200 with identical encrypted bytes (octet-stream) — status=404 type=undefined same=false route missing
FAIL    AC-8: non-done task → 409 — status=404
FAIL    AC-9: thumbs PUT for hash with no pv_images row → 404 and no R2 write — status=200 r2_puts=["prompt-vault/thumbs/no-row.enc"]
FAIL    S-1: handler routes /api/prompt-vault/queue/task/:id/data — routed=false
SUMMARY issues=1 gated=1 pass=2 fail=8 gated_fail=8
```

### 修正後（foundation）

```
PASS    AC-1: unsaved done task → 200 with identical encrypted bytes (octet-stream) — status=200 type=application/octet-stream same=true
PASS    AC-1/AC-7: data route does not SELECT/INSERT pv_images — pv_images accesses=[] route=true
PASS    AC-8: nonexistent / cleaned id → 404 / non-done → 409 / R2 missing → 404
PASS    S-1: saved task still served while task remains — save=200 data=200
PASS    AC-9: thumbs PUT no row → 404, r2_puts=[] ／ saved hash → 200, thumb_ok=1
PASS    S-1: handler routes /api/prompt-vault/queue/task/:id/data
SUMMARY issues=1 gated=1 pass=10 fail=0
```

### negative control（prompt-vault-dev・現行 b395917）

```
SUMMARY issues=1 gated=1 pass=1 fail=11 gated_fail=11
（AC-2 /gallery/image/ occurrences=3 ／ AC-5 resolveResultsOwner missing ・ revision-keyed setResults([]) still present ／ AC-9 total calls=2 …）
```

### 修正後（prompt-vault-dev）

```
PASS ×12（AC-2 ×4 ／ AC-8 ×2 ／ AC-9 ×3 ／ AC-5 ×2 ／ S-3 ×1）
AC-5 trace: blip=[["cloud/A",false],["offline/A",false],["cloud/A",false]] cloud→fran=true fran→cloud=true token A→B=true token B→(offline)→C=true
SUMMARY issues=1 gated=1 pass=12 fail=0
```

## 気づいた点（参考）

- 入口の照合：`src/worker/index.js` の `handleRequest` は family-auth を通った要求だけを受け取り、`/api/prompt-vault/*` をすべて `handlePromptVault` に流している。新しい経路もこの内側にある（AC-10 の curl はデプロイ後に行う）
- `src/worker/chat-web/healthz.js` にも `version: '0.25.4'` があるが、chat-web のコードには触れない規定なので変えていない（foundation の inspect は 0.25.5 で緑）
- `.phase6b-*` の一時ディレクトリが prompt-vault-dev に18個残っている（既存の verifier が作ったもの。本件では触れていない）

## 指示待ち

対策Y（推奨）と Y' のどちらで進めるか、または別の方針かを指示してほしい。指示を受けたら、コミット・push、Worker → フロントの順のデプロイ、AC-10 の curl を行い、本報告を完了報告（AC対応表様式）に書き換える。
