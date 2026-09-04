# prompt-vault 画面遷移状態保持＋キュー結果表示 修正指示書

文書種別: 権威文書

作成日: 2026-09-04 ／ PM: クリーデ

## 背景

発注者の実使用中に発見された2件のバグ。

1. **画面移動でカード選択状態がリセットされる** — App.jsx が `activeTab` の条件分岐で GenerateScreen を描画しているため、タブ切替→コンポーネントアンマウント→全 useState 消失。カード選択、ランダム設定、スロット有効/無効、プロンプト編集内容がすべて消える。
2. **キューから生成した画像が結果エリアに並ばない** — キュー完了タスクは `queueData.tasks` にのみ格納され、メインの `results` 配列に追加されない。キューパネル内の小さなサムネイルにしか表示されず、ResultCard グリッドに現れない。

## 作業範囲

prompt-vault-dev のみ。Worker（ai-family-foundation）は変更しない。

## 修正内容

### 修正1: GenerateScreen の常時マウント（App.jsx）

GenerateScreen だけは常時マウントし、CSS `display` で表示/非表示を切り替える。他のタブ（Album, Template）は従来通り条件レンダリングでよい。

```jsx
// 変更前
let mainContent;
if (activeTab === 'generate') {
  mainContent = <GenerateScreen .../>;
} else if (activeTab === 'album') {
  mainContent = <AlbumScreen .../>;
} else if (...) { ... }

// 変更後
// GenerateScreen は常時マウント（display で切替）
// 他のタブは条件レンダリング
```

JSX 部分で:

```jsx
<div style={{ display: activeTab === 'generate' ? 'block' : 'none' }}>
  <GenerateScreen addToast={addToast} results={results} setResults={setResults}
    maxResults={maxResults} resetKey={resetKey} connectionRoute={connectionState.route} />
</div>
{activeTab === 'album' && <AlbumScreen addToast={addToast} resetKey={resetKey} connectionRoute={connectionState.route} />}
{activeTab === 'template' && <TemplateScreen addToast={addToast} resetKey={resetKey} />}
{activeTab !== 'generate' && activeTab !== 'album' && activeTab !== 'template' && <PlaceholderView message="未実装のタブです" />}
```

### 修正2: キュー完了タスクを results に自動追加（GenerateScreen.jsx）

queueData のポーリングで新たに `status === 'done'` になったタスクを検出し、results に追加する。

#### 方針

- 追加済みタスクIDを `useRef(new Set())` で追跡し、重複防止
- 初回マウント時の既存完了タスクは追加しない（画面を開く前に完了していたものまで並べない）
- ポーリングによって新たに done に変わったタスクだけを追加
- クラウド経路: 画像をfetch→復号→blobUrl作成してから追加（handleGenerate の既存処理と同じパターン）
- フラン経路: task.result.filename をそのまま使用

#### 実装ガイド

1. `useRef(new Set())` — `addedTaskIdsRef` を定義
2. 初回マウント時に既存の done タスクIDを `addedTaskIdsRef` に登録（追加はしない）
3. `useEffect` で `queueData.tasks` を監視。新たに done になったタスク（`addedTaskIdsRef` に未登録）を検出
4. 検出したタスクごとに:
   - `task.result` が文字列なら `JSON.parse` する
   - クラウド経路: fetch + decrypt → blobUrl 生成
   - entry = `{ ...parsedResult, task_id: task.id, folderSegments: task.folder_segments || [], filenameSegments: task.filename_segments || [], saved: !!task.saved, blobUrl (cloud) }`
   - `setResults(prev => [entry, ...prev].slice(0, maxResults))`
   - `addedTaskIdsRef.current.add(task.id)`

## テスト・検収基準

| # | テスト | 合格条件 |
|---|---|---|
| T-1 | 生成タブでカード選択→アルバムタブ→生成タブに戻る | カード選択、ランダム設定、プロンプト編集内容が保持されていること |
| T-2 | 生成タブでキューに1件追加→実行→完了 | 完了後に結果グリッドに画像が表示されること |
| T-3 | キューの保存ボタン押下後、結果グリッドの同じ画像にも保存状態が反映されること | 二重表示・矛盾がないこと |
| T-4 | regression: 単発生成の動作が変わらないこと | 生成→結果グリッドに表示→保存が従来通り動くこと |

## 禁止事項

- Album/Template の描画方式は変えない（条件レンダリングのまま）
- queueData のポーリングロジック（2秒間隔）を変えない
- Worker 側のコードに触らない

## 報告先

docs/reports/ に報告書を置く。T-1〜T-4 の各結果を明記すること。
