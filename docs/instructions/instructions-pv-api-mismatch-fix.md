# prompt-vault クラウド経路 API不整合修正＋自動更新通知 実装指示書

文書種別: 権威文書

作成日: 2026-09-03 ／ PM: クリーデ

## 背景

フロントのapi.jsが呼ぶエンドポイントとWorker側のハンドラーの全量突き合わせにより、3件のAPI不整合が判明した。加えて、フロントのデプロイ後に旧バージョンが使われ続ける問題への対策として自動更新通知を追加する。

## 作業範囲

- ai-family-foundation（修正1, 2）
- prompt-vault-dev（修正3, 4）

## 修正内容

### 修正1: generate.js — レスポンスにtask_id追加（ai-family-foundation）

`functions/api/prompt-vault/generate.js` の生成完了レスポンスにDOのtask.idを追加する。

変更前:
```javascript
return Response.json({ success: true, image: JSON.parse(task.result) });
```

変更後:
```javascript
return Response.json({ success: true, image: JSON.parse(task.result), task_id: task.id });
```

### 修正2: debug/test-api — POSTメソッド対応（ai-family-foundation）

`src/worker/handlers/prompt-vault.js` のルーティングで、`/api/prompt-vault/debug/test-api` がGETのみ許可になっている。フロントは `api.testApi()` でPOSTを送るため405になる。POSTも許可する。

### 修正3: GenerateScreen.jsx — task_idの保持とsave分岐（prompt-vault-dev）

既にPGが一度修正済みだが、修正1が前提のため再確認する。

- `handleGenerate` でresultに `task_id` を保持する（`result.task_id` から取得）
- `handleSave` でクラウド経路の場合は `api.saveImage({ task_id: item.task_id })` を送る
- フラン経路は従来通り `{ filename, seed, folderSegments, filenameSegments }` を送る

### 修正4: 自動更新通知（prompt-vault-dev）

デプロイ後に旧バージョンのJSが使われ続ける問題への対策。以下のいずれかの方式で実装する:

- Service Worker（sw.js）の更新検知 → 「更新があります」トースト → 自動リロード
- あるいは、アプリ起動時にindex.htmlのbundleファイル名を定期チェック（ポーリング）し、変化を検知したらトースト→リロード

要件: ユーザー操作なしで新バージョンに切り替わること。

## テスト・検収基準

| # | テスト | 合格条件 |
|---|---|---|
| T-1 | クラウド経路で生成→保存 | 保存ボタンで「✓ 保存済み」になる。400エラーが出ない |
| T-2 | フラン経路で生成→保存 | 従来通り動作する |
| T-3 | debug/test-api（クラウド） | フロントの設定画面から疎通テストボタンを押して結果が表示される（405が出ない） |
| T-4 | 自動更新通知 | デプロイ後にアプリを開いた状態で「更新があります」トーストが出てリロードされる |

## 禁止事項

- DOのPvQueue.jsの既存ロジック（暗号化・キュー管理）に触らない
- 他のエンドポイントのレスポンス構造を変更しない

## 報告先

docs/reports/ に報告書を置く。T-1〜T-4の各結果を明記すること。
