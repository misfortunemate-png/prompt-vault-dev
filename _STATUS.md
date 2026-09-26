---
project: prompt-vault
version: 4.0.1
milestone: 生成直後の画像表示（pv#81）
status: in_progress
updated: 2026-09-26
next: PM検収待ち・発注者実機確認（pv#81 AC-3/4/6/7）
---

## 完了
- M1〜M6: PWA/生成/カード/ギャラリー/キュー/ローカルAPI基盤
- v3.7〜v3.13: 生成UI、NAI V5、Cloud/Fran接続、暗号化、ランダムサイズ生成
- #27: healthzでruntime git SHAを公開
- #28: GitHub Pages deploy workflow整備
- #56/#64/#68: Cloud/Fran endpointをproduct-owned canonical値へ固定し、通常ユーザー編集を廃止
- #70: Albumのbackend切替時stale response混入を防止
- #49: connection revision導入、API層でbackend-scoped stale responseを共通破棄
- #69: README初期設定を現行接続設計へ更新
- 回帰verifier Batch 1: #5/#8/#9/#53/#56 — 5件を tests/issues/ に追加・manifest登録 (16件全件PASS)

## 現在の未解決事項
- #54 [P1]: Cloudflare Pages本番がmain更新を確実に反映するdeploy経路の確認・復旧

## 接続設計原則
- Fran/Cloud endpointはアプリ所有。通常ユーザーにURLを入力させない。
- ユーザーが設定するのはCloud Token / Vault Key等、アプリが代替できない情報のみ。
- endpoint semantic変更時はmigrationと文書更新を同一変更で扱う。
