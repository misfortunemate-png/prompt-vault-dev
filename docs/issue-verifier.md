# Issue Verifier

このrepositoryには、GitHub Issue単位の機械検収があります。

## できること

- Issueごとの修正確認
- 修正済みIssueの回帰検知
- `PASS / FAIL / NOT_RUN / WAIVED` の判定
- JSON形式での結果取得
- closed IssueだけをCI gateにする運用
- open Issueの既知FAILをCIを落とさず表示

## 使い方

全Verifier：

```
npm run verify:issues
```

特定Issue：

```
npm run verify:issues -- pv#16
npm run verify:issues -- foundation#17
```

JSON：

```
npm run verify:issues -- --json
```

open Issueを含む全FAILを厳格判定：

```
npm run verify:issues -- --strict-all
```

`NOT_RUN`も失敗扱い：

```
npm run verify:issues -- --strict-not-run
```

## 判定

- `PASS` — 検収条件を満たす
- `FAIL` — 検収条件を満たさない
- `NOT_RUN` — 現在の環境では未実行
- `WAIVED` — 既知の残件だが受容済み

`gate:true` のIssueでFAILすると通常CIが失敗する。
`gate:false` のIssueはFAILを表示するが通常CIは失敗しない。

## Claude Codeでの利用

Issue修正時は対象Verifierを修正前後に実行する。

```
npm run verify:issues -- <issue-id>
npm run build
npm run inspect
npm run verify:issues
```

Verifierの追加・修正は `tests/issues/` と `tests/issues/manifest.mjs` を使用する。

`WAIVED` や `gate` は外部レビュー側の受入判断なので、特に指示がない限り変更しない。
