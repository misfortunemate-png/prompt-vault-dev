---
project: prompt-vault
version: 3.3.0
milestone: M3
status: done
updated: 2026-08-19
---

## M1: 基盤構築（完了）

- [x] サーバー骨格・設定画面・PWA・tailscale配線・NW改修

## M2: 生成画面＋アルバム（完了）

- [x] novelai.js（ZIPパーサー・V4.5）・generate/save/images API
- [x] AlbumScreen.jsx（新着・フォルダ・4象限ナビ）

## M3: カードシステム（完了）

- [x] data/cards.json・data/presets.json 初期化・CRUD API
- [x] danbooruタグ検索API（GET /api/tags/search）
- [x] M2マイグレーション（VAULT_ROOT/presets.json→cards.json）
- [x] 保存API M3形式（folderSegments/filenameSegments/seed）
- [x] TemplateScreen（スロット・カード・プリセット管理）
- [x] TagSuggest・TagInput コンポーネント
- [x] GenerateScreen カードベース合成・インライン編集
- [x] Toastの10秒自動フェードアウト
