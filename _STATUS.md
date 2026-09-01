---
project: prompt-vault
version: 3.13.0
milestone: ランダムサイズ生成
status: done
updated: 2026-09-01
next: Worker統合待ち
---

## 完了マイルストーン

- [x] M1〜M3: サーバー骨格・PWA・生成・カードシステム
- [x] M4-A/B: ギャラリー基盤・ImageViewer・お気に入り・検索
- [x] M5: ジョブキュー・直積
- [x] bugfix v3.5.1: CSS・fetchSeq・captionバグ
- [x] v3.6.1: ビューアからカード登録・削除・グリッドサイズ
- [x] v3.6.2: サムネ先行・台詞表示・カード/プリセットリデザイン・F排他
- [x] M6: ローカルHTTP API（chat-pwa vault_generate接続・外部連携API仕様）
- [x] v3.7.0: .env fallback・ImageViewerセリフ編集改善・四象限タップ復元
- [x] v3.8.0: 生成画面UI改善（トースト・プロンプト記憶・有効/ランダム・フォルダ親子・入力欄拡大）
- [x] v3.9.0: バッチ2（NAI v4.5キャラプロンプト・カード選択永続化・サムネ修正・空カードフィルタ・タブリセット）
- [x] v3.10.0: NAI V5対応（V5 Full/Curated追加・PoC成功・キャラプロンプト検証・model_name対応）
- [x] v3.11.0: クラウド化第一便（connection.js経路選択・api.js動的BASE・Header.jsxランプ・SettingsScreen接続設定/選定則/vault鍵管理・crypto.js AES-256-GCM）
- [x] v3.12.0: クラウド最小コア(フロント)（server.js CORS M-4・AlbumScreen/ImageViewer復号分岐・GenerateScreen hash対応・generateCloudThumbnail・connection.js resolveApiUrl）
- [x] v3.12.1: フラン経路regression修正（franUrl port:8445修正・migrateState・Vary:Origin・connectionRoute prop・album/generate retryロジック）
- [x] v3.12.2: fetchReachableタイムアウト 3s→8s（tailscale初回接続が遅い環境でcloudフォールバックしていた問題修正）
- [x] v3.12.3: cloud route でvaultReady=true固定（cloud WorkerにVAULT_ROOTがないため生成画面が壊れていた問題修正）
- [x] v3.13.0: ランダムサイズ生成（縦/横/正方からランダム選択・生成/キュー/直積の全ルート対応・チェックボックスOFF時は既存動作を維持）
