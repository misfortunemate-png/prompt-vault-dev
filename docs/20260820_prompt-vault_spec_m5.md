# Prompt Vault M5 仕様書 v1.0

文書種別: 権威文書
作成日: 2026-08-20 ／ PM: クリーデ ／ 根拠: 要件定義v1.3 R-2（ジョブ予約キュー・直積バッチ）、設計決定#9（決定的ジョブキューのみ）・#10（ガード値）

## §1 スコープ

M5 = ジョブ予約キュー＋ガード。プリセットやカードの組み合わせを変えた複数の生成ジョブをキューに積み、手動発火で直列実行する。

- In: キュー管理（追加・削除・クリア）、直積バッチ展開、直列実行（ランダム間隔・エラー即時中断）、実行中の進捗UI、設定画面のガード値との連携
- Out: 無人スケジュール実行、画像の自動保存（結果確認後に手動保存）

## §2 データモデル

キューはサーバー側のインメモリ配列で管理する（永続化しない）。サーバー再起動でキューは消える。

### §2.1 キュータスク

```json
{
  "id": "t_a1b2c",
  "status": "pending",
  "positive": "girl, blue hair, ..., portrait, best quality",
  "negative": "blurry, lowres, ...",
  "params": {
    "model": "nai-diffusion-4-5-full",
    "width": 832,
    "height": 1216,
    "steps": 28,
    "scale": 5,
    "sampler": "k_euler_ancestral",
    "seed": null
  },
  "folderSegments": ["キャラA"],
  "filenameSegments": ["制服"],
  "preset_id": "p_m1n2o",
  "label": "キャラA × 制服",
  "result": null,
  "error": null
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| id | string | `t_` + ランダム5文字hex |
| status | string | `pending` / `running` / `done` / `error` / `skipped` |
| positive | string | 合成済み正プロンプト |
| negative | string | 合成済み負プロンプト |
| params | object | 生成パラメータ（M2仕様と同じ構造） |
| folderSegments | string[] | 保存先フォルダセグメント |
| filenameSegments | string[] | 保存先ファイル名セグメント |
| preset_id | string | プリセットID（任意） |
| label | string | 表示用ラベル（カード名の組み合わせ） |
| result | object\|null | 生成結果（`{ filename, seed, width, height }`）。実行完了まで null |
| error | string\|null | エラーメッセージ。正常時 null |

### §2.2 キュー状態

```json
{
  "state": "idle",
  "tasks": [...],
  "currentIndex": null,
  "startedAt": null
}
```

- `state`: `idle` / `running` / `paused`（エラー中断時）
- `paused` はエラーで中断した状態。再開またはクリアを待つ

## §3 API

### §3.1 キュー管理

| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/queue | キュー全体取得（state + tasks） |
| POST | /api/queue/add | タスク追加（1件 or 複数件） |
| DELETE | /api/queue/task/:id | タスク削除（pending時のみ） |
| DELETE | /api/queue/clear | キュー全クリア（idle/paused時のみ） |
| POST | /api/queue/start | 実行開始（idle/paused→running） |
| POST | /api/queue/stop | 実行中断（running→paused） |

### §3.2 POST /api/queue/add

リクエスト:
```json
{
  "tasks": [
    {
      "positive": "...",
      "negative": "...",
      "params": { ... },
      "folderSegments": [...],
      "filenameSegments": [...],
      "preset_id": "...",
      "label": "..."
    }
  ]
}
```

- 追加前にガードチェック: 現在のキュー件数 + 追加件数 ≤ maxPerJob。超過時は400エラー
- レスポンス: `{ success: true, added: N, total: N }`

### §3.3 POST /api/queue/start

1. state を `running` に変更
2. currentIndex を 0（または paused時は中断位置の次）に設定
3. 直列実行ループ開始（§4）
4. レスポンスは即時返却（実行はバックグラウンド）

### §3.4 実行中のステータス取得

`GET /api/queue` で現在の進捗を取得。フロントは2秒ポーリング。

## §4 実行エンジン

### §4.1 直列実行ループ

```
for each task (currentIndex → tasks.length):
  1. task.status = 'running'
  2. 生成実行（novelaiGenerate）
  3. 成功 → task.status = 'done', task.result = { filename, seed, ... }
         → 即時保存（POST /api/save相当のロジック）
         → 即時インデックス登録
  4. 失敗 → task.status = 'error', task.error = message
         → 残りのタスクを 'skipped' に
         → state = 'paused'
         → ループ中断
  5. ランダム間隔待機（intervalMin〜intervalMaxの一様乱数・秒）
全タスク完了 → state = 'idle'
```

### §4.2 ガード値

設定画面のガード値（`data/settings.json` の `guard` セクション）から読み取る:
- `intervalMin`: 最小間隔（秒）。既定2
- `intervalMax`: 最大間隔（秒）。既定5
- `maxPerJob`: キュー上限。既定100

### §4.3 即時保存

M5ではキュー実行中の結果は**自動保存**する（1枚ずつ手動保存するのは連続生成の意味がないため）。保存ロジックはM3の `POST /api/save` と同じ（folderSegments/filenameSegments/seed → パス導出 → ファイル移動 → DB登録）。

### §4.4 中断と再開

- `POST /api/queue/stop`: running → paused。現在実行中のタスクの完了を待ってから中断（生成リクエスト送信後のキャンセルは行わない）
- paused状態から `POST /api/queue/start`: 次のpendingタスクから再開

## §5 生成画面UI

### §5.1 キューパネル

生成画面の下部にキューパネル（折りたたみ式）を追加。

**折りたたみ時**: 「キュー（N件）」バー。タップで展開。

**展開時**:
- タスクリスト: 各タスクのlabel＋status（アイコン: ⏳pending / 🔄running / ✅done / ❌error / ⏭skipped）
- pendingタスクの×ボタン（個別削除）
- 下部ボタン行:
  - **▶ 実行**: idle/paused時。キュー実行開始
  - **⏸ 中断**: running時。実行中断
  - **🗑 クリア**: idle/paused時。キュー全クリア（確認ダイアログ）

### §5.2 キューへの追加

既存の「生成」ボタンの横に**「＋キュー」ボタン**を追加。

- タップ → 現在のカード選択＋パラメータからタスクを1件生成し、`POST /api/queue/add`
- 追加成功 → トースト「キューに追加（N/maxPerJob）」
- maxPerJob超過 → トースト「キュー上限に達しています」

### §5.3 直積バッチ

「＋キュー」ボタンの横に**「＋直積」ボタン**を追加。

タップ → 直積ダイアログが開く:
- 各スロットについて「固定（現在の選択）」or「全展開（このスロットの全カード）」をトグルで選択
- プレビュー: 展開後のタスク数を表示（例: 「1×4×1×1×1 = 4件」）
- 「追加」で展開されたタスクを一括キュー追加

例: キャラクターを「キャラA」固定、衣装を「全展開」（制服/私服/水着/ドレス）→ 4件のタスクが生成される。

### §5.4 実行中の進捗表示

キューパネル展開中:
- 進捗バー: `currentIndex / tasks.length`
- 現在のタスクのlabelを表示
- 経過時間と推定残り時間

2秒ポーリングで `GET /api/queue` を取得し更新。

## §6 テスト方針

### PG自己完結

| 項目 | 手順 | 合格基準 |
|---|---|---|
| キュー追加 | ＋キュー→1件追加 | キューパネルに表示 |
| キュー上限 | maxPerJob超過分を追加 | エラートースト |
| タスク削除 | pendingタスクの×ボタン | 削除される |
| キュークリア | 🗑ボタン | 確認後にクリア |
| 単発実行 | 1件追加→▶実行 | 生成→自動保存→done |
| 連続実行 | 3件追加→▶実行 | 直列で3件完了。間隔あり |
| ランダム間隔 | 連続実行中にコンソール確認 | intervalMin〜intervalMax内のランダム |
| エラー中断 | 不正なプロンプトで生成→エラー | 該当タスクerror、残りskipped、state=paused |
| 中断→再開 | 3件中1件目完了→⏸→▶ | 2件目から再開 |
| 直積バッチ | 1スロット全展開→追加 | N件のタスクが追加 |
| 自動保存 | 実行完了→アルバム確認 | 画像が保存・インデックス登録済み |
| 進捗表示 | 実行中のキューパネル | 進捗バー・ラベル更新 |
| ガード値変更 | 設定画面で間隔変更→実行 | 新しい間隔で動作 |
| build | npm run build | 警告なし |
| inspect | npm run inspect | ALL GREEN |

### 実機（発注者に依頼）

- Pixel 10からのキュー操作・実行の操作感
- 連続実行中の画面離脱→復帰で進捗が正しく表示されるか

## 改訂履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-08-20 | v1.0 | 初版（PM起草） |
