# ④ 同期・境界ロジック一括修正 作業指示書
文書種別: 権威文書

作成日: 2026-09-10 ／ PM: クリーデ
上位文書:
- ai-family-ops/docs/20260910_pv-sync-contract_v1.0.md（同期契約・付表A/B）
- ai-family-ops/docs/20260910_pv-review2_remediation-policy_v1.0.md §2-④

対象Issue:
- ai-family-foundation: #5, #6, #8, #9, #10, #11, #13
- prompt-vault-dev: #10, #11, #13, #15, #16

前提: ①（契約統一・cards.json正常化）および②（#12, #15, #18）の完了

## 現状維持の原則（§6-0・発注者承認条件・転記）

> フロントエンドの機能集合・画面構成・操作体系は現状を維持する。
> 以下の適用は対象Issueの修正に必要な最小限とし、新たな画面・操作・機能を追加しない。

本指示のすべての修正はこの原則に従属する。原則との矛盾が生じた場合は停止し発注者へ差し戻す。

## 添付マニフェスト（着工前照合・必須）

| # | 参照 | 種別 |
|---|---|---|
| 1 | 同期契約v1.0（§1〜§7・付表A/B） | 権威文書 |
| 2 | 方針書 §2-④ | 対象Issue列挙・制約 |
| 3 | ai-family-foundation #5,#6,#8,#9,#10,#11,#13 | Issue |
| 4 | prompt-vault-dev #10,#11,#13,#15,#16 | Issue |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航
2. **着工前**: 各リポジトリで `git pull` → inspect

---

## Part 1: pv-sync.mjs push/handback再構成（ai-family-foundation）

### 要件

同期契約v1.0 §1-§5に基づき、現行のmerge/LWW同期を**push/handback二操作**に再構成する。

旧: pvCardsSync（union merge + LWW）/ pvPresetsSync（collection LWW）/ pvSettingsSync（overlay merge）/ pvImageUp + pvImageDown + pvMetaSync
新: push（Fran→Cloud全置換）/ handback（Cloud→Fran全置換 + baseline guard）

### 1-1: push操作の実装

**pv-sync.mjs に `--mode push` オプションを追加。**

pushは以下を順に実行する:

1. Fran GET /api/cards → Cloud PUT /api/prompt-vault/cards（camelCase全置換）
2. Fran GET /api/presets → Cloud PUT /api/prompt-vault/presets（全置換）
3. Fran GET /api/settings → Cloud PUT /api/prompt-vault/settings（共有settingsのみ。付表Bのsync.*キーは除外）
4. 既存 pvImageUp ロジック（Fran→Cloud画像転送。差分転送を維持）
5. baseline記録: 各collection（cards/presets/settings）のSHA-256と時刻をJSONファイルに保存（例: `data/.pv-sync-baseline.json`）

```javascript
const baseline = {
  created_at: new Date().toISOString(),
  cards_sha: sha256(JSON.stringify(franCards)),
  presets_sha: sha256(JSON.stringify(franPresets)),
  settings_sha: sha256(JSON.stringify(sharedSettings)),
};
writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
```

完了報告: `{ mode: 'push', ok: true/false, baseline, counts }`
エラー時: globalOk=false, exitCode=2（Phase 5D-4修正を維持）

### 1-2: handback操作の実装

**pv-sync.mjs に `--mode handback` オプションを追加。**

handbackは以下を順に実行する:

1. **baseline guard（§3-4）**: `data/.pv-sync-baseline.json` を読み、Fran現行のcards/presets/settings SHA-256を算出。baseline記録と不一致なら**中止して報告**する（exitCode=3）。不一致時のmerge・自動修正は一切行わない。

```javascript
const current = {
  cards_sha: sha256(JSON.stringify(await franGet('/api/cards'))),
  presets_sha: sha256(JSON.stringify(await franGet('/api/presets'))),
  settings_sha: sha256(JSON.stringify(filterShared(await franGet('/api/settings')))),
};
if (current.cards_sha !== baseline.cards_sha ||
    current.presets_sha !== baseline.presets_sha ||
    current.settings_sha !== baseline.settings_sha) {
  console.error('Baseline mismatch — Fran was modified during Cloud period. Aborting.');
  process.exitCode = 3;
  return;
}
```

2. Cloud GET /api/prompt-vault/cards → Fran PUT /api/cards（camelCase全置換）
3. Cloud GET /api/prompt-vault/presets → Fran PUT /api/presets（全置換）
4. Cloud GET /api/prompt-vault/settings → 共有settingsのみFranへ PUT /api/settings（Franのsync.*キーは保持）
5. 画像取込（§4-2対応）:
   - Cloud同期用列挙APIから**全件**のpending-downloads取得（#9: recent/favorites上限を撤廃。paging対応）
   - soft-delete済み（deleted_at != null）を除外（#12: ②で対応済みの前提）
   - ダウンロード時に**preset_id, created_at**をmetadataとして引き渡す（#11）
   - ファイル衝突時は一意名退避（#6: `_001`サフィックス。§6-5）
   - safeResolveでパス境界チェック（既存修正を維持）
6. caption同期（#8）: Cloud同期用APIからcaption本文を取得し、Franのimage metadataを更新
7. 削除同期（§5-2）: Cloud tombstone（deleted_at付き）をFranへ適用
8. baseline削除: handback完了後に `data/.pv-sync-baseline.json` を削除

### 1-3: Cloud同期用API（#8, #9対応）

Cloud側に同期専用の列挙エンドポイントを追加する。現行のUI用APIとは別のパスとする（付表A §4-2、契約§4-2）。

**GET /api/prompt-vault/sync/images**（新規または既存endpoint拡張）

要件:
- 全画像のmetadata一覧を返す（recent/favoritesの上限なし。#9）
- **caption本文を含む**（#8）
- **preset_id, created_at を含む**（#11）
- deleted_at を含む（tombstone可視化）
- paging対応（offsetまたはcursor。§6-0により画面追加はしないが、API自体は追加可）

```json
{
  "images": [
    {
      "hash": "abc123",
      "filename": "girl_12345.png",
      "folder": "original/char_a",
      "created_at": "2026-09-01T...",
      "preset_id": "p_xxx",
      "favorite": 1,
      "caption": "full caption text here",
      "meta_updated_at": "2026-09-02T...",
      "deleted_at": null,
      ...付表A-4の同期対象フィールド
    }
  ],
  "total": 587,
  "offset": 0,
  "limit": 100
}
```

### 1-4: folder tree差異の修正（foundation #13）

Cloud `GET /api/prompt-vault/gallery` と `/gallery/folder` の返却形状をFranと統一する。

Franは子フォルダを`subfolders`配列（階層tree構造）で返す。Cloudは`folders`配列（flat）で返す。

Cloud側のgallery handlerを修正し、D1のfolder列から階層treeを構築して返す:

```javascript
function buildFolderTree(folders) {
  // flat folder list → nested tree
  const root = { name: '', children: [], count: 0 };
  for (const { folder, count } of folders) {
    const parts = folder.split('/');
    let node = root;
    for (const part of parts) {
      let child = node.children.find(c => c.name === part);
      if (!child) { child = { name: part, children: [], count: 0 }; node.children.push(child); }
      node = child;
    }
    node.count = count;
  }
  return root;
}
```

### 1-5: 旧merge/LWWコードの除去

pvCardsSync（L170-235）、pvPresetsSync（L240-290）、pvSettingsSync（L295-335）の旧mergeロジックを**削除**し、push/handbackの呼び分けで置き換える。

エントリポイント:

```javascript
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : null;

if (!mode || !['push', 'handback'].includes(mode)) {
  console.error('Usage: node scripts/pv-sync.mjs --mode push|handback');
  process.exit(1);
}

if (mode === 'push') await runPush();
if (mode === 'handback') await runHandback();
```

旧来の無引数実行（merge mode）は**廃止**（同期契約§9-5）。

---

## Part 2: フロントエンド境界修正（prompt-vault-dev）

### 2-1: 接続判定の認証確認（#10）— §6-2

`src/lib/connection.js` の `checkReachability()` を修正する。

Cloud接続判定を healthz の HTTP 200 だけでなく、**認証済みAPIが成功すること**で判定する:

```javascript
// 既存: healthz HTTP 200 で接続済み
// 修正: healthz + 認証付きAPIの成功
const healthOk = await fetch(`${url}/healthz`).then(r => r.ok).catch(() => false);
if (!healthOk) return 'offline';

const authOk = await fetch(`${url}/settings`, {
  headers: { 'Authorization': `Bearer ${token}` },
}).then(r => r.ok).catch(() => false);

return authOk ? 'cloud' : 'offline';
```

無効tokenの場合は`offline`扱いとし、接続済み表示にしない。

### 2-2: Fran専用機能の非表示（#13, #15）— §6-3

`connectionRoute` が `'cloud'` のとき、以下のUI要素を非表示またはdisabledにする:

- SettingsScreen: FS書込テストボタン（#13）— Cloud接続時に `display: none`
- AlbumScreen: リスキャンボタン（#15）— Cloud接続時に `display: none`

§6-0制約: 新しいUI要素は追加しない。既存要素の表示制御のみ。

```jsx
{connectionRoute !== 'cloud' && (
  <button onClick={handleTestFs}>FS書込テスト</button>
)}
```

### 2-3: 接続切替state残留の完全修正（#16）

pv-dev #16は先行修正（7836acb）でresultsクリアとAlbumScreen state resetを実装したが、以下が残っている（verifier pv#16 FAIL）:

- in-flight response identity guard: 切替直前に発行されたfetch応答が切替後のstateに混入する可能性
- queue stateの持ち越し: GenerateScreenのqueue関連state（queueStatus等）が切替後も残る

修正:

```javascript
// App.jsx のroute変更effect
useEffect(() => {
  setResults([]);
  setQueueStatus(null); // queue stateもクリア
}, [connectionState.route]);
```

in-flight guard は、fetchの戻り先で `connectionRoute` の一致を確認する:

```javascript
const routeAtFetch = connectionRoute;
const res = await api.someCall();
if (connectionRoute !== routeAtFetch) return; // stale response、破棄
```

GenerateScreen内のfetch結果処理箇所に上記ガードを追加する。全箇所への追加が困難な場合は、最もリスクの高い `handleGenerate` と `handleSave` に限定し、報告に追加箇所を明記する。

### 2-4: サムネイル処理統一（#11）

Cloud thumbsはauthenticated + encryptedで返り、folder previewとviewer fallbackで処理が不統一。

修正方針: `api.getThumb(hash)` を一元化し、Cloud接続時はAuthorizationヘッダー付きfetch→復号→blob URLを返す共通関数を設ける。folder preview・viewer fallback・AlbumScreen全てがこの関数を使う。

§6-0制約: サムネイル表示の見た目や操作は変えない。内部のfetch経路を統一するだけ。

---

## コミット指針

### ai-family-foundation
1. `refactor(#5,#10): replace merge/LWW sync with push/handback per contract v1.0`
2. `feat(#8,#9): add sync/images API with caption, full enumeration, paging`
3. `fix(#11): include preset_id and created_at in image download metadata`
4. `fix(#6): unique filename on handback file conflict`
5. `fix(#13): build hierarchical folder tree in Cloud gallery API`

### prompt-vault-dev
1. `fix(#10): require authenticated API success for Cloud connection`
2. `fix(#13,#15): hide Fran-only UI elements on Cloud connection`
3. `fix(#16): clear queue state and add in-flight response guard on route change`
4. `fix(#11): unify Cloud thumbnail fetch with auth+decrypt`

## 禁止事項

- 新画面・新操作・新機能の追加（§6-0）
- D1 migration追加（②の範囲の#15を除く）
- pv_cards_sync / pv_presets_sync の旧mergeモードの温存
- 同期契約§8の既知の制限を解消する実装（Fran起点削除のCloud伝播等）

## テスト

- PG自己完結分:
  - 両リポジトリのinspect合格
  - pv-dev `npm run build` 成功
  - `node scripts/pv-sync.mjs` を引数なしで実行し、usage表示＋exit 1であること
  - `--mode push` の正常系（Fran→Cloud転送＋baseline記録）
  - `--mode handback` の正常系（Cloud→Fran転送＋baseline削除）
  - handback時にFran cards.jsonを手動変更し、baseline不一致でexit 3中止を確認
  - issue verifier: `npm run verify:issues`
- NOT RUN:
  - 実画像の転送テスト（Fran新規画像→Cloud→handback→Fran）
  - caption同期の実データテスト
  - 実ブラウザでのCloud接続切替UI確認
  - Worker再デプロイ（Part 1のCloud API変更反映に必要）

## 完了条件

1. pv-sync.mjsが `--mode push` / `--mode handback` の二操作のみで動作すること
2. 旧merge/LWWコード（pvCardsSync, pvPresetsSync, pvSettingsSync）が除去されていること
3. baseline記録・照合・中止が実装されていること
4. Cloud同期用APIがcaption・preset_id・created_at・全件列挙を提供すること
5. Cloud folder tree APIがFranと同じ階層構造を返すこと
6. フロントがCloud接続時にFran専用機能を非表示にすること
7. 接続切替時にqueue state・in-flight responseが残留しないこと
8. サムネイル取得が共通関数経由で統一されていること
9. 各Issue verifierがFAIL→PASS（またはPASS_WITH_WAIVER）に改善していること
10. 両リポジトリのinspect合格

## 報告基準

報告は prompt-vault-dev の docs/reports/ に置く。

1. Part 1（sync再構成）・Part 2（フロント）の実施結果
2. 完了条件の各項に対する充足状況
3. push/handback各テストの実行結果
4. baseline不一致テストの実行結果
5. issue verifier結果
6. inspect結果
7. NOT RUN項目
8. §6-0に抵触する判断が必要だった箇所があれば列挙
9. Workerデプロイ要否
