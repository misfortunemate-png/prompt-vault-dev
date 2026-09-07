# Prompt Vault Phase 4レビュー独立バグ修正バッチ 作業指示書
文書種別: 権威文書

作成日: 2026-09-08 ／ PM: クリーデ ／ 本書一枚で完結（追補なし）
起因: 外部レビューPhase 4で登録されたIssueのうち、独立に修正できる8件。

## 添付マニフェスト（着工前照合・必須）

| # | 参照 | 種別 |
|---|---|---|
| 1 | prompt-vault-dev GitHub Issues #16〜#23 | 外部レビュー指摘（PM事実確認済み） |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**（本工程は支給物なし）
3. **発注者指示による仕様外修正**: 実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記。権威文書は書き換えない
4. **着工前**: `git pull` → `npm run inspect`（既存赤以外に新規赤がないこと）

## 作業範囲

- **何を**: pv-dev #16〜#23の8件修正
- **なぜ**: 接続切替時のデータ混線（#16,#17）、一時ファイル蓄積（#18）、重複表示（#19）、部分失敗の隠蔽（#20）、stale UI（#21）、キャッシュクリア不全（#22）、CORS不達（#23）
- **どこで**: prompt-vault-dev（D:\AI\github\prompt-vault-dev）
- **触らないもの**: ai-family-foundation、Cloud APIの応答形状、cards/presets schema

---

## 作業手順

### 手順1: 接続切替時のstate reset（#16, #17）

**#16 — GenerateScreen results/queue stateのクリア**

`src/App.jsx` のconnectionState.route変更を監視するeffectで、route変更時にresultsをクリアする。

L151付近の `[connectionState.route, connectionState.manual]` を依存配列にしたuseEffectの中に、route変更時のクリアを追加する:

```javascript
useEffect(() => {
  // 既存のcheckReachabilityロジックはそのまま
  // ...
  // route変更時にGenerate結果をクリア
  setResults([]);
}, [connectionState.route, connectionState.manual]);
```

あるいは別のuseEffectとして分離してもよい:

```javascript
useEffect(() => {
  setResults([]);
}, [connectionState.route]);
```

**#17 — AlbumScreen viewer/folder stateのreset**

`src/screens/AlbumScreen.jsx` L304-308のconnectionRoute変更effectで、loadRoot()の前に全stateをresetする。L310-316のresetKey effectと同じresetパターンを使う:

```javascript
useEffect(() => {
  if (!connectionRoute || connectionRoute === 'offline') return;
  // connectionRoute変更時にstate reset（resetKeyと同じパターン）
  setPath(null);
  setFlatMode(null);
  setFolderData(null);
  setViewer(null);
  setFavUpdates({});
  setRecentImages([]);
  setLoading(true);
  loadRoot().finally(() => setLoading(false));
}, [connectionRoute, loadRoot]);
```

### 手順2: .tmp一時ファイルの削除（#18）

`server/generate.js` の `executeSave()` で、`copyFileSync(srcPath, finalPath)` の直後に一時ファイルを削除する。

```javascript
copyFileSync(srcPath, finalPath);
// 一時ファイルの削除（失敗しても保存は成功扱い）
try { unlinkSync(srcPath); } catch {}
```

`unlinkSync` を既存のimport文に追加:

```javascript
import { readFileSync, mkdirSync, copyFileSync, existsSync, statSync, unlinkSync } from 'fs';
```

単発生成の破棄（save しなかった場合）についても、一時ファイルが残る。`POST /generate` のレスポンス後に `.tmp` 内のファイルを消す機会がないため、以下のいずれかで対応する:

- **案A（推奨）**: server起動時に`.tmp/`内の古いファイル（1時間以上前）をクリーンアップする
- **案B**: 破棄ボタン押下時にフロントからDELETEリクエストを送る

案Aの場合、`server.js` の起動処理（listen前）に以下を追加:

```javascript
// .tmp クリーンアップ（1時間以上前の一時ファイルを削除）
try {
  const tmpDir = join(process.env.VAULT_ROOT, '.tmp');
  if (existsSync(tmpDir)) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const f of readdirSync(tmpDir)) {
      const fp = join(tmpDir, f);
      try {
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
      } catch {}
    }
  }
} catch {}
```

### 手順3: Cloud単発generateのdone task重複追加防止（#19）

`src/screens/GenerateScreen.jsx` の `handleGenerate` 成功時（L1062付近）に、`addedTaskIdsRef` への登録を追加する。

Cloud経由で生成した結果を`results`に追加する箇所で、`result.task_id` が存在すれば ref に登録する:

```javascript
if (result.task_id) {
  addedTaskIdsRef.current.add(result.task_id);
}
```

これをsetResultsの直前か直後に配置する。

### 手順4: Fran保存のDB登録失敗をエラーとして返す（#20）

`server/generate.js` の `executeSave()` で、DB登録失敗時の`console.warn`だけのcatchを修正する。

修正方針: DB登録に失敗した場合、ファイル自体は正式保存先に存在するため、レスポンスにwarningを含めてフロントに通知する。ただし保存自体は成功扱いとする（ファイルは存在するため）。

```javascript
let dbWarning = null;
try {
  // hash計算、upsertImage、thumbnail生成
  // ...
} catch (dbErr) {
  console.warn('[Save] DB登録失敗:', dbErr.message);
  dbWarning = dbErr.message;
}

return {
  saved_path: `${folderPath}/${finalFilename}`,
  filename: finalFilename,
  folder: folderPath,
  hash,
  warning: dbWarning,
};
```

`server.js` の保存レスポンスで `warning` が存在すれば、フロントのaddToastにwarningとして通知する:

```javascript
// server.js POST /save レスポンス
if (result.warning) {
  // 200で返すが、warningフィールドを含める
  res.json({ ...result, warning: result.warning });
}
```

フロント側（GenerateScreen.jsx）の保存成功ハンドラでwarningを表示:

```javascript
if (r.warning) {
  addToast('warning', `保存しましたがDB登録に問題があります: ${r.warning}`);
}
```

### 手順5: favorite/delete後のstale state修正（#21）

**favorite解除時のflatMode更新**:

`src/screens/AlbumScreen.jsx` L430 の `handleFavoriteToggle` を修正する。お気に入りフィルタ表示中に解除した場合、flatMode.imagesからも除去する:

```javascript
const handleFavoriteToggle = useCallback((hash, val) => {
  setFavUpdates(prev => ({ ...prev, [hash]: val }));
  // お気に入りフィルタ表示中に解除した場合、一覧から除去
  if (!val) {
    setFlatMode(prev => {
      if (!prev || prev.type !== 'favorites') return prev;
      return { ...prev, images: prev.images.filter(img => img.hash !== hash) };
    });
  }
}, []);
```

**delete時のfolder集計の再取得は省略する。** stale表示（枚数が1枚多い）は次回フォルダ遷移で解消されるため、通信コストに見合わない。

### 手順6: thumbDb clearAll追加とキャッシュクリア連携（#22）

`src/lib/thumbDb.js` に `clearAll` 関数を追加:

```javascript
export async function clearAll() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // fallback: DB自体を削除
    try { indexedDB.deleteDatabase(DB_NAME); } catch {}
  }
}
```

`src/screens/SettingsScreen.jsx` の `handleClearSW`（L260付近）でthumbDbのclearAllも呼ぶ:

```javascript
import { clearAll as clearThumbDb } from '../lib/thumbDb';

const handleClearSW = async () => {
  // 既存: SW cache clear
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
  }
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  // 追加: IndexedDBサムネイルキャッシュもクリア
  await clearThumbDb();
  location.reload();
};
```

### 手順7: Cloudflare Pages preview URL CORS修正（#23）

`server.js` の `ALLOWED_ORIGIN_PATTERNS` 正規表現を修正する。

Cloudflare Pagesのpreview URLは `<hash>.prompt-vault-6gr.pages.dev`（ドット区切り）:

```javascript
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9]+\.)?prompt-vault-6gr\.pages\.dev$/
];
```

`-` を `.` に変更するだけ。既存の本番URL（`https://prompt-vault-6gr.pages.dev`）はキャプチャグループが0回マッチで引き続き通る。

---

## コミット指針

2コミット推奨:
- `fix(#16,#17): reset state on connection route change`
- `fix(#18,#19,#20,#21,#22,#23): tmp cleanup, duplicate prevention, stale state, thumbDb clear, CORS`

または全件1コミットでも可。

## 禁止事項

- ai-family-foundationリポジトリへの変更
- Cloud APIの応答形状変更
- cards/presets schemaの変更
- inspectスクリプトの変更（別案件の範囲）

## テスト

- PG自己完結分:
  - `npm run build` / `npm run build:pages` 成功
  - inspect（既存赤以外に新規赤なし）
  - server起動後、手順2の.tmpクリーンアップが動作すること（console出力等で確認）
- NOT RUN（実機テスト・発注者に依頼):
  - 接続をFran→Cloud（またはその逆）に切り替えた後、Generate結果一覧がクリアされること（#16）
  - 接続切替後、Album画面がルートから再ロードされること（#17）
  - 設定画面の「SWキャッシュクリア」実行後、IndexedDBのpv-thumb-cacheが消えていること（#22）

## 完了条件

- 8件の修正がコミット・push済み
- `npm run build` 成功
- inspect合格（既存赤以外に新規赤なし）

## 報告基準

報告は docs/reports/ に置く。

1. 実装内容の要約（手順1〜7の結果）
2. 完了条件の充足状況
3. inspect結果
4. NOT RUN項目の列挙
5. 手順2（.tmp）で案A/案Bどちらを採用したか
6. 手順4（#20）のフロント側warning表示の実装有無
