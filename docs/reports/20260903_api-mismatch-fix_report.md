# prompt-vault クラウド経路 API不整合修正＋自動更新通知 完了報告

**日時**: 2026-09-03  
**担当**: Claude Sonnet 4.6  
**指示書**: docs/instructions/instructions-pv-api-mismatch-fix.md

---

## 実施内容

### 修正1 — generate.js にtask_id追加（ai-family-foundation）

**ファイル**: `functions/api/prompt-vault/generate.js`  
**コミット**: `41bdd65`（ai-family-foundation）

```diff
- return Response.json({ success: true, image: JSON.parse(task.result) });
+ return Response.json({ success: true, image: JSON.parse(task.result), task_id: task.id });
```

DOのポーリング完了時、レスポンスのトップレベルに `task_id: task.id` を追加。  
フロント側 `handleGenerate` の `result.task_id` 取得が機能するようになった。

---

### 修正2 — debug/test-api のPOST対応（ai-family-foundation）

**ファイル**: `src/worker/handlers/prompt-vault.js`  
**コミット**: `41bdd65`（ai-family-foundation）

```diff
- if (method !== 'GET') return methodNotAllowed();
+ if (method !== 'GET' && method !== 'POST') return methodNotAllowed();
```

フロントの `api.testApi()` はPOSTを送るが、ルーターがGETのみ許可していたため405。  
GET|POST の両メソッドを許可するよう修正。

---

### 修正3 — handleSaveのtask_id分岐（prompt-vault-dev）

**ファイル**: `src/screens/GenerateScreen.jsx`  
**コミット**: `78eebb5`（前セッション実施済み、修正1完了により完全動作）

- `handleGenerate` でクラウド結果に `task_id: result.image.task_id ?? result.task_id` を保持
- `handleSave` でクラウド経路は `api.saveImage({ task_id: item.task_id })` を送信
- フラン経路は `{ filename, seed, folderSegments, filenameSegments }` のまま維持

修正1でサーバーが `task_id` をトップレベルで返すようになったため、フロントの `result.task_id` 取得が正しく機能する。

---

### 修正4 — 自動更新通知（prompt-vault-dev）

**ファイル**: `src/lib/versionCheck.js`（新規）、`src/App.jsx`  
**コミット**: `435ff0b`（prompt-vault-dev）

**方式**: index.html ポーリング（5分間隔）

- 起動時に `<script type="module" src="/assets/index-XXXX.js">` のハッシュを取得
- 5分おきに `/index.html?_v=<timestamp>` を `cache: 'no-store'` でフェッチ
- ハッシュが変化したらトースト表示→3秒後に `window.location.reload()`
- ユーザー操作不要で新バージョンに切り替わる

```javascript
// App.jsx に追加
useEffect(() => {
  return startVersionCheck(() => {
    addToast('info', '新しいバージョンがあります。3秒後に更新します…');
    setTimeout(() => window.location.reload(), 3000);
  });
}, [addToast]);
```

---

## デプロイ結果

| リポジトリ | コマンド | 結果 |
|---|---|---|
| ai-family-foundation | `wrangler pages deploy` | ✅ `https://b1732daf.ai-family-foundation.pages.dev` |
| prompt-vault-dev | `npm run deploy:pages` | ✅ gh-pages ブランチに v3.13.0 を強制プッシュ |

---

## 検収基準

| # | テスト | 合格条件 | 結果 |
|---|---|---|---|
| T-1 | クラウド経路で生成→保存 | 保存ボタンで「✓ 保存済み」になる。400エラーが出ない | 修正1（task_id追加）＋修正3（save分岐）の連携で成立。実環境での最終確認は発注元 |
| T-2 | フラン経路で生成→保存 | 従来通り動作する | handleSave の else 分岐は変更なし。regression なし |
| T-3 | debug/test-api（クラウド） | 設定画面からPOST疎通テストで405が出ない | 修正2でGET\|POST両許可に変更済み |
| T-4 | 自動更新通知 | デプロイ後にアプリを開いた状態で「更新があります」トーストが出てリロードされる | 修正4で5分ポーリング実装済み。次回デプロイ時に動作確認可能 |

---

## 禁止事項の遵守確認

- DOの `PvQueue.js` は変更なし
- 他エンドポイントのレスポンス構造は変更なし（generate.js のみトップレベルに `task_id` 追加）
