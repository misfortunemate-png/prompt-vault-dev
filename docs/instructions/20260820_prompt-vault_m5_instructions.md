# Prompt Vault M5 作業指示書
文書種別: 権威文書

作成日: 2026-08-20 ／ PM: クリーデ ／ 対応仕様: docs/20260820_prompt-vault_spec_m5.md v1.0 ／ 本書一枚で完結

## 添付マニフェスト（着工前照合・必須）

| # | パス | 種別 | SHA-256 |
|---|---|---|---|
| 1 | docs/20260820_prompt-vault_spec_m5.md | 仕様書 | — |
| 2 | docs/supplied/tokens.css | PM支給物 | 4850377ad7e24581657e3117ed64e08b666f183ea05ede51240a13517db2eb07 |
| 3 | docs/supplied/danbooru-filtered.csv | PM支給物 | fd9f677d2f0bdab7e1bf644a9ea76a1e5d861b7698e3b0d06a6158df465e13f7 |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**
3. **発注者指示による仕様外修正**: 報告時に明記
4. **着工前**: `git pull` → inspect

## 作業範囲

- 何を: ジョブ予約キュー（追加・直積展開・直列実行・ランダム間隔・エラー中断・自動保存）＋ガード＋進捗UI
- なぜ: 要件定義v1.3 R-2（連続生成）
- どこで: misfortunemate-png/prompt-vault-dev（main）

## 作業手順

### Step 1: キューエンジン (server/queue.js 新規)

1. インメモリキュー管理: tasks配列、state（idle/running/paused）、currentIndex
2. `addTasks(tasks[])`: ガードチェック（現在件数 + 追加件数 ≤ settings.guard.maxPerJob）→ 追加
3. `removeTask(id)`: pending時のみ削除
4. `clearQueue()`: idle/paused時のみ全削除
5. `startQueue()`: idle/paused → running。直列実行ループを `setImmediate` でバックグラウンド開始
6. `stopQueue()`: running → paused。現在のタスク完了後に中断（フラグ制御）
7. `getStatus()`: state + tasks + currentIndex + startedAt を返す

### Step 2: 直列実行ループ (server/queue.js 続き)

1. currentIndexから順にタスクを実行:
   - status = 'running'
   - novelaiGenerate呼び出し（既存の生成ロジックを再利用）
   - 成功 → status = 'done'、result格納
   - **自動保存**: M3のsaveロジック（パス導出→ファイル移動→DB登録）を内部呼び出し
   - 失敗 → status = 'error'、error格納、残りを'skipped'、state = 'paused'、ループ終了
   - ランダム間隔待機: `intervalMin + Math.random() * (intervalMax - intervalMin)` 秒
2. 全タスク完了 → state = 'idle'
3. stop要求フラグをループ毎にチェック。フラグONなら現タスク完了後にstate = 'paused'

**novelaiGenerateとsaveのロジック再利用**: server.jsのPOST /generateとPOST /saveのロジックをserver/generate.jsなどに関数として切り出し、queue.jsとserver.jsの両方から呼べるようにする。コピペ禁止——共通関数化すること。

### Step 3: サーバーAPI (server.js)

1. キューAPI追加（仕様 §3.1）:
   - `GET /api/queue` → queue.getStatus()
   - `POST /api/queue/add` → queue.addTasks(req.body.tasks)
   - `DELETE /api/queue/task/:id` → queue.removeTask(id)
   - `DELETE /api/queue/clear` → queue.clearQueue()
   - `POST /api/queue/start` → queue.startQueue()
   - `POST /api/queue/stop` → queue.stopQueue()
2. ガード値はsettings.jsonのguardセクションから読み取り。addTasks時とstartQueue時にチェック

### Step 4: 生成画面UI (GenerateScreen.jsx)

1. 「生成」ボタンの横に**「＋キュー」ボタン**と**「＋直積」ボタン**を追加
2. 「＋キュー」: 現在のカード選択＋パラメータからタスク1件を構築 → POST /api/queue/add → トースト
3. 「＋直積」: 直積ダイアログを開く
   - 各スロットについて「固定」/「全展開」トグル
   - 展開プレビュー（件数表示）
   - 「追加」でタスクを一括生成 → POST /api/queue/add
4. 画面下部にキューパネル（折りたたみ式）:
   - 折りたたみバー: 「キュー（N件）」。running時は進捗バーも表示
   - 展開時: タスクリスト（label＋statusアイコン）＋pendingの×ボタン
   - ボタン行: ▶実行 / ⏸中断 / 🗑クリア
5. running時は2秒ポーリングで GET /api/queue → 進捗更新
6. 進捗表示: 進捗バー、現在のタスクlabel、経過時間、推定残り時間

### Step 5: CLAUDE.md・inspect・version

1. CLAUDE.mdにM5機能（キュー・直積・ガード）を追記
2. package.json version → `3.6.0`
3. _STATUS.md更新（M5セクション追加）

## 禁止事項

- docs/supplied/ 配下の改変
- React Router の導入
- npm依存の追加
- generateロジック・saveロジックのコピペ（共通関数に切り出すこと）
- cron/スケジューラ/無人自動実行の実装

## テスト

仕様書 §6 のテスト方針に準拠。

| 項目 | 手順 | 合格基準 |
|---|---|---|
| ＋キュー | カード選択→＋キュー | 1件追加・キューパネルに表示 |
| ＋直積 | 1スロット全展開→追加 | N件追加 |
| 上限チェック | maxPerJob超過分を追加 | エラートースト |
| タスク削除 | pendingの×ボタン | 削除 |
| キュークリア | 🗑→確認 | 全削除 |
| 単発実行 | 1件→▶ | 生成→自動保存→done→state=idle |
| 連続実行 | 3件→▶ | 直列完了。間隔あり |
| ランダム間隔 | コンソール確認 | intervalMin〜intervalMax |
| エラー中断 | 不正タスク→▶ | error→残りskipped→paused |
| 中断→再開 | running→⏸→▶ | 次のpendingから再開 |
| 自動保存 | 実行完了→アルバム | 画像保存・DB登録済み |
| 進捗表示 | 実行中キューパネル | バー・ラベル・時間更新 |
| generate/save共通化 | 単発生成（既存）も動作確認 | 既存機能が壊れていない |
| build | npm run build | 警告なし |
| inspect | npm run inspect | ALL GREEN |

## 完了条件

- キューの追加・削除・クリア・実行・中断・再開が動作する
- 直積バッチで複数タスクが展開・実行される
- ランダム間隔が設定画面のガード値に従う
- エラー時にキュー全体が中断する
- 実行結果が自動保存・インデックス登録される
- 単発生成（既存）が壊れていない
- inspect緑・_STATUS.md更新（version 3.6.0）

## 報告基準

報告は docs/reports/ に置く。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約（特にgenerate/save共通化の構造）
2. 完了条件の各項に対する充足状況
3. inspect結果
4. 未検証項目
5. サーバー再起動・コミット・プッシュの実施状況
