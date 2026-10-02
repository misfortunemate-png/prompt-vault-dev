# 停止報告 — pv#95 当たらない入力の観測化（着工前）

- 文書種別: 作業文書（PG 停止報告）
- 対応指示書: docs/instructions/instructions-pv-095-invalid-residue.md
- pull: main `e1603b4`
- 作成: 2026-10-02 PG
- 停止条件: 指示書「PG運用規律」4（inspect が緑でなければ着工しない）

## 1. 事象

`git pull`（`e1603b4`）の後、inspect（`ComSpec` を Git Bash にして実行）がマニフェスト照合で赤になった。

```
  ❌ Missing: docs/instructions/instructions-pv-095-invalid-residue.md（本書）
  ❌ Missing: docs/reports/report-95-invalid-residue.md（調査回答・対象 main `91118ff`）
  package.json version: 4.0.1
  healthz version: 4.0.1
  Lines: 11

=== Inspect Results ===

❌ マニフェスト照合: FAILED
✅ 支給物SHA-256照合
✅ 版確認
✅ _STATUS.md 行数
✅ danbooru-filtered.csv SHA-256
✅ ビルド確認

=== SOME CHECKS FAILED ===
```

マニフェストの 4 点は目視ではすべて揃っている。

| # | 参照 | 確認 |
|---|---|---|
| 1 | docs/instructions/instructions-pv-095-invalid-residue.md | 存在する |
| 2 | docs/reports/report-95-invalid-residue.md | 存在する（72 箇所・ID S-01〜S-22／F-01〜F-12・F-14〜F-18／§4.3 #1〜#27／T-01〜T-06） |
| 3 | pv#95・pv#98〜pv#103 の本文と PM コメント | 読めた。pv#103 にラベル「軽微」あり |
| 4 | PR #97 | OPEN（未マージ）。差分（CLAUDE.md の C-1・C-2）は読めた |

## 2. 原因 X

指示書のマニフェスト表のパス欄に注記が同じ欄で付いている（`…md（本書）`・`…md（調査回答・対象 main …）`）。`scripts/inspect.mjs` のマニフェスト照合（L36-48）は、パス欄の文字列をそのまま `existsSync` に渡すため、注記ごとファイル名と見なして「Missing」になる。注記付きのパス欄はこの指示書が初めて（`docs/instructions/` を grep して他に 0 件）。

なお、この指示書を入れた PR #104 は docs だけの変更なので、CI は inspect を回さずに（docs fast-path）マージされている。このため main の inspect が赤であることは CI では見えていない。

## 3. 対策 Y（いずれかの裁定を求める）

| 案 | 内容 | 変更する文書 | 備考 |
|---|---|---|---|
| A（推奨） | PM が指示書のマニフェスト表の注記をパス欄から外す（種別欄へ移す） | 権威文書（指示書）— PM | コードを変えない。PG はその後 pull → inspect 緑を確かめて着工 |
| B | PG が `scripts/inspect.mjs` のマニフェスト照合で、パス欄の最初の空白・全角括弧より前だけをパスとして読むように直す | コード類 — PG | 指示書の影響範囲表に inspect.mjs はあるが、指示の中身は T-02（版確認の理由）のみ。照合規則の変更は指示にないため停止条件 1 に当たる。採る場合は pv#99 のコミットに含める |

## 4. 実行可否

- 案 A: PG 側の作業なし。PM の指示書修正の後に着工できる
- 案 B: 実行可能（数行）。PM の許可があれば着工の最初に行い、inspect 緑を確かめてから pv#98 に入る

コード・データ・本番には何も変更していない。

## 5. あわせて依頼すること

- PR #97（CLAUDE.md「コードの規則」C-1・C-2）は未マージ。指示書は「未マージの間は PR #97 の差分を正とする」としているので着工の妨げにはならないが、pv#95 の PM コメントのとおり発注者へのマージ依頼が残っている
