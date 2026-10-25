# prompt-vault クラウド改修 作業指示書（prompt-vault v4.2.0 ／ foundation）
文書種別: 権威文書

作成日: 2026-10-25 ／ PM改訂: 2026-10-25（S-1〜S-4裁定） ／ 対応仕様: docs/prompt-vault-cloud-spec.md ／ 対応要件定義: docs/prompt-vault-cloud-requirements-approved.md ／ 関連Issue: pv#115 ／ 本書一枚で完結（追補なし）

## 添付マニフェスト（着工前照合・必須）

以下がすべて交換所（リポジトリ）に存在すること。**1つでも欠けたら着工せず docs/reports/ に報告。**

| # | パス | 種別 | SHA-256（支給物のみ） |
|---|---|---|---|
| 1 | docs/prompt-vault-cloud-spec.md | 仕様書 | — |
| 2 | docs/prompt-vault-cloud-requirements-approved.md | 承認済み要件定義 | — |
| 3 | prompt-vault-dev #115 | Issue | — |
| 4 | src/lib/crypto.js | 暗号化フォーマット参照 | — |
| 5 | docs/reference/prompt-vault-reference.md | 既存API参照 | — |

支給物なし。

## PM裁定（2026-10-25／PG停止報告S-1〜S-4）
**本節を改訂後の正典とする。以下に残存する旧作業例・旧パス・旧削除指示が本節と矛盾する場合は、本節を優先し、旧記述を実施しない。** 参照先 `docs/prompt-vault-cloud-spec.md` も同じ裁定で改訂済みである。

### S-1: 同期対象の保存
- `data/settings.json` の `sync.folders` は**使用しない**。既存 `PUT /api/settings` が全置換するためである。`data/sync.json` の `{ "folders": [] }` に保存し、未作成なら空配列、原子的に書き込む。
- 同期選択API（GET/PUT `/api/sync/folders`）はこの独立ファイルを使う。従来の `server/validate.js`、設定画面の既存保存処理、`PUT /api/settings` を変更しない。R2上限は従来のsettingsのフラットキー `'sync.r2_limit_gb'`（なければ5GB）。
- SQLでフォルダの完全一致と子フォルダ接頭辞を照合し、名前に `%`/`_` が含まれてもワイルドカード扱いしない。
- 追加変更範囲としてランタイムデータ `data/sync.json` を許可する。

### S-2: 旧pv-syncの撤去
- `ai-family-foundation/scripts/pv-sync.mjs` の**物理削除は本件では行わない**。2026-09-22以来fire-runnerから外れている旧ジョブは、稼働停止状態を継続する。手動実行の再開もしない。
- verifier16本・fixture2本・共有ライブラリは無変更、waived化もしない。foundationの別件未コミット10ファイルには触れない。本件のfoundation作業はWorkerエンドポイントと旧ジョブ停止の**確認のみ**。foundation側の変更コミットは不要。
- 物理削除とverifier整理は新同期の稼働・検収後に別Issue/別指示書で行う。今回の完了報告には削除延期を明記する。

### S-3: クラウド送信先、トークン、vault鍵
- `CLOUD_BASE` 既定: `https://ai-family-foundation.misfortunemate.workers.dev`。旧pv-syncの有効な **`CLOUD_TOKEN`** を同名で再利用する。`FA_TOKEN_MACHINE` を推測で代用しない。インフラPGが既存有効トークンを探し、可能なら認証付きGET `/api/prompt-vault/sync/images` の200を確認する。トークンが見つからない・認証に失敗する場合は、実データ送信せずPMへ停止報告。
- `server/sync.js` 内に同期専用のsecretローダーを実装。`process.env` 優先、不足した `PV_VAULT_KEY`、`CLOUD_TOKEN`、`CLOUD_BASE` の3キーに限り `D:\\AI\\secrets\\secrets.env`（`PV_SYNC_SECRETS_PATH` 指定時はそのパス）から読み込む。Node.js v24の `node:util.parseEnv` 相当を使い、他の秘密をprocess.env全体に注入しない。既存package.jsonの起動コマンド・server.jsの既存設定ローダーは**変更しない**。
- `PV_VAULT_KEY` はbase64の32バイト鍵。秘密未配置でもフラン通常起動は継続し、同期開始は503。`CLOUD_TOKEN` の欠落、Workerから401/403の場合は送信しない。鍵・トークン値はログ、エラーメッセージ、GitHubに記録しない。
- `.env.example` に `PV_VAULT_KEY=`、`CLOUD_TOKEN=`、`CLOUD_BASE=`、`PV_SYNC_SECRETS_PATH=` を空値で追加する。
- Worker画像転送は旧契約の `PUT /api/prompt-vault/sync/upload-image`（Bearer `CLOUD_TOKEN`、`X-PV-Hash`、base64 JSON `X-PV-Meta`、multipart `image`）。サムネイルは `PUT /api/prompt-vault/thumbs/{hash}`。API契約相違・Worker変更の必要が判明したら再停止。

### S-4: 既存クラウドPNGのWebP上書き（発注者裁定）
- **選択したフォルダの既存クラウドhashも表示用WebP（原寸q80）に上書きする**。対象外フォルダの既存画像は削除せず保持する。後から新たに選択されたフォルダも同じ扱い。
- 同期モジュールが本体WebPとサムネイルを**両方とも送信成功**させたhashを、`data/sync-webp-state.json` の `{ "uploadedHashes": [] }` に原子的に永続化する。初期状態は空。ランタイムデータとして新設を許可する。フォルダ選択とは別ファイルにする。
- 選択フォルダ画像のうち (A)クラウドに存在しないhash、または (B)クラウドにあってもWebP送信済み記録がないhash を送信する。両方に存在するhashは再同期時skip。片方でも転送失敗なら記録を残さず次回再試行する。送信済みhashがクラウドから消えていれば再送する。
- クラウドで明示削除済み（`deleted_at`）のhashは無断で復活させない。クラウドインベントリ/容量取得失敗、R2上限超過見込みではfail closed（送信せず `lastRun.errors` に秘密なしで記録）。
- PG報告N-1〜N-5も承認する。B-1の真の修正対象 `src/components/ImageViewer.jsx` は変更を許可。存在するサムネイル生成関数名は `generateAndUploadThumb`。フォルダ名は完全一致とする。

### AC追加と報告
- **AC-13**: 既存クラウドhashがWebPに上書きされ、復号でWebPバイナリと確認できる。旧差分だけの実装では失敗するnegative controlを残す。
- **AC-14**: 2度目は送信済みhashをskip、失敗hashは再試行、後から選んだフォルダの既存hashは上書きされる。失敗注入ログを残す。
- **AC-15**: secrets未配置でもフラン通常起動、同期503。有効トークン200と無効トークン401/403で送信停止を確認。秘密を伏せたログを残す。
- **AC-16**: foundation既存verifier/fixtureが維持され、新規赤なし。旧ジョブ不使用を確認。
- **AC-17**: 従来の設定保存とサーバー再起動を挟んでも、同期フォルダ選択とWebP送信成功記録が保持される。旧方式の消失をnegative controlとする。

AC-1〜12に加えてAC-13〜17もPG完了報告のAC対応表に列挙し、生ログまたは証跡ファイルを付ける。既存 `AC-2` は `PUT /api/settings` による従来設定保存を挟む試験に拡張する。`AC-12` は**両リポジトリ**で実行する。実Workerを使う検証が秘密情報/環境不足で実施できない場合は未検証と明記し、未実施のまま完了扱いにしない。作業指示書の末尾に残る旧 `pv-sync.mjs` 削除の完了条件は**無効**とする。

---

## PG運用規律（定型・全フェーズ共通）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**: PM支給物はdiffゼロで検収される。技術的整合の調整もPMへ差し戻す
3. **発注者指示による仕様外修正**: 発注者から直接指示を受けた修正は実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記する。権威文書は書き換えない
4. **着工前**: 両リポジトリで `git pull` → inspect実行（マニフェスト照合・版確認）。緑でなければ着工しない。着工確認はチャット定型②（process.md §2.6）で発話する
5. **稼働設定の変更三手順**: 稼働中の共有インフラ設定（ポート・serve/funnel等）に触れる場合は、状態記録→スクリプト一本で変更→差分確認の順とする。アドホックなコマンド連打での変異は禁止（#018）

## 作業範囲

- 何を: フランサーバーに同期モジュール（server/sync.js）を内蔵し、選択フォルダの画像をWebP変換・AES-256-GCM暗号化してクラウドへ転送する仕組みを構築する。設定画面にフォルダ選択UI・手動同期ボタンを追加する。既知不具合B-1〜B-3を修正する。旧pv-sync.mjsを廃止する
- なぜ: 旧同期ジョブ（pv-sync）除去後、フラン→クラウドの画像同期が停止している。承認済み要件定義（docs/prompt-vault-cloud-requirements-approved.md）および仕様書（docs/prompt-vault-cloud-spec.md）による
- どこで: prompt-vault-dev（主作業: サーバー・フロント）＋ ai-family-foundation（従作業: pv-sync廃止・Worker確認）

## 影響範囲（PM調査済み——「ここが全部だ」）

### 検索1: `createObjectURL|revokeObjectURL` in src/（B-3関連）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/AlbumScreen.jsx | L98, L120, L211 createObjectURL; L215 revokeObjectURL | 要修正（B-3: unmount時の解放確認） |
| src/screens/GenerateScreen.jsx | L138, L552, L1140 createObjectURL; L145 revokeObjectURL | 要修正（B-3: unmount時の解放確認） |
| src/components/ImageViewer.jsx | L85, L95 createObjectURL; L114, L120 revokeObjectURL | 確認のみ（既にrevoke実装あり） |
| src/lib/api.js | L180 createObjectURL | 確認のみ |
| src/screens/TemplatePresetList.jsx | L38, L46 revokeObjectURL | 対象外（revokeのみ） |
| src/screens/TemplateCardList.jsx | L38, L46 revokeObjectURL | 対象外（revokeのみ） |

### 検索2: `SettingsScreen`（フォルダ選択UI追加先）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/SettingsScreen.jsx | L184 export default function SettingsScreen | 要修正（クラウド同期セクション追加） |
| src/App.jsx | L8 import, L264 usage | 確認のみ |

### 検索3: `connectionRoute`（フラン接続判定）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/GenerateScreen.jsx | 使用箇所あり | 対象外 |
| src/screens/TemplateCardList.jsx | 使用箇所あり | 対象外 |
| src/screens/TemplatePresetList.jsx | 使用箇所あり | 対象外 |
| src/screens/TemplateScreen.jsx | 使用箇所あり | 対象外 |
| src/screens/AlbumScreen.jsx | 使用箇所あり | 対象外 |
| src/App.jsx | 使用箇所あり | 対象外 |

### 検索4: `thumb_ok` in src/（B-2関連）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/AlbumScreen.jsx | L94-139 thumb_ok判定・IndexedDBキャッシュ・フォールバック | 要修正（B-2: thumb_ok=0のプレビュー表示） |

### 検索5: `setLoading|isLoading`（B-1関連）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/screens/GenerateScreen.jsx | 使用箇所あり | 確認のみ |
| src/screens/AlbumScreen.jsx | 使用箇所あり | 要修正（B-1: サムネイル404時のローディング解除） |

### 検索6: `getThumb|/thumbs/` in src/（サムネイル経路）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/lib/api.js | L170 getThumb, L176 cloudUrl + '/thumbs/' | 確認のみ |
| src/lib/connection.js | L331-332 thumb URL routing | 確認のみ |
| src/lib/thumbGen.js | L30 cloud thumb upload | 確認のみ |
| src/lib/thumbDb.js | L19 getThumb | 確認のみ |
| src/components/ImageViewer.jsx | L72 thumb URL construction | 確認のみ |
| src/screens/AlbumScreen.jsx | L7 import, L96/109/202 | 要修正（B-1/B-2関連） |

### 検索7: `encrypt|decrypt` in crypto.js（暗号化フォーマット互換）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| src/lib/crypto.js | L54 importKey, L82 encrypt(), L88 subtle.encrypt, L98 decrypt() | 確認のみ（server/sync.jsの暗号化はこのフォーマットと同一にする） |

### 検索8: settings.json in server/（フォルダ選択の保存先）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| server.js | L65 SETTINGS_PATH = join(__dirname, 'data', 'settings.json') | 確認のみ（sync.jsからも同じパスを参照） |
| server/queue.js | L10 SETTINGS_PATH | 確認のみ |
| server/genParams.js | L100 settings.json参照 | 確認のみ |

### 検索9: server/ ディレクトリ構成（sync.js新設先）

既存ファイル: db.js, genParams.js, generate.js, log.js, png-meta.js, providers/, queue.js, scanner.js, validate.js
→ sync.js は新設ファイル。既存ファイルとの名前衝突なし。

### 検索10: pv-sync 参照（非.md）

| ファイル | 該当箇所 | 対応要否 |
|---|---|---|
| tests/issues/pv-100-write-guard.mjs | pv-sync参照 | 確認のみ（テストコメント等であれば除去不要） |
| tests/issues/pv-113-key-id-alias.mjs | pv-sync参照 | 確認のみ |
| src/lib/crypto.js | pv-sync参照 | 確認のみ（コメントであれば除去不要） |
| server.js | pv-sync参照 | 確認のみ |

（PMがgrepした結果。PGは表にない箇所を触る場合、停止条件1で報告する）

---

## 作業手順

### Part 1: 同期モジュール新設（server/sync.js）

#### 1-1: vault key・クラウド接続情報の読み込み
`server/sync.js` を新設。秘密は同期専用ローダーで取得する（PM裁定S-3を参照）。`process.env` 優先、未指定の3キー `PV_VAULT_KEY`・`CLOUD_TOKEN`・`CLOUD_BASE` だけを `D:\\AI\\secrets\\secrets.env` から解析して取得する。秘密ファイルがなければ通常サーバー起動を続行する。認証情報や32バイトvault鍵が不正／欠落の場合、同期開始時は503、トークン認証401/403では転送しない。秘密値をログ・エラーに入れない。

#### 1-2: 暗号化関数

`src/lib/crypto.js` と**同一のバイナリフォーマット**で暗号化する。フロントの `decrypt()` でそのまま復号できること。

```javascript
const DEFAULT_KEY_ID = 'vault:v1';

function encrypt(plainBuffer, keyBuffer, keyId = DEFAULT_KEY_ID) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  const idBytes = Buffer.from(keyId, 'utf-8');
  const result = Buffer.alloc(1 + idBytes.length + 12 + encrypted.length + tag.length);
  result[0] = idBytes.length;
  idBytes.copy(result, 1);
  iv.copy(result, 1 + idBytes.length);
  encrypted.copy(result, 1 + idBytes.length + 12);
  tag.copy(result, 1 + idBytes.length + 12 + encrypted.length);
  return result;
}
```

**暗号文フォーマット（crypto.jsと同一）:**

```
[1byte: key_id長][key_id UTF-8][12bytes: IV][残り: ciphertext + 認証tag(16bytes)]
```

注意点:
- Web Crypto API（フロント）は `ciphertext` にtagが結合されて返る。Node.jsの `createCipheriv` は `getAuthTag()` で別途取得する。末尾に連結する
- IVは毎回ランダム生成する
- `keyId` は `'vault:v1'` 固定（KEY_ID_ALIASESにより `'v1'` も許容されるが、サーバーは `'vault:v1'` で暗号化する）

#### 1-3: フォルダ選択APIの実装
`data/sync.json`（未作成なら `{ "folders": [] }`）を原子的に保存する。旧 `data/settings.json` の `sync.folders` には保存しない。既存の `PUT /api/settings` / `validateSettings` は無変更とする。

- `GET /api/sync/folders`: SQLite imagesテーブルから最上位フォルダと子フォルダを含めた画像数を集計し、`data/sync.json` に基づく選択状態とともに返す。従来どおり `{ "folders": [{ "name": "キャラA", "selected": true, "imageCount": 1200 }] }`。
- `PUT /api/sync/folders`: `{ "folders": ["キャラA"] }` のうち存在するフォルダのみ保存。存在しない名はC-1/C-2 invalidへ記録。名前に `%`/`_` が含まれてもワイルドカード照合しない。

#### 1-4: 同期実行API

**POST /api/sync/run**

同期をバックグラウンドで開始する。二重実行防止あり。

```javascript
let syncState = { state: 'idle', lastRun: null, progress: null };

app.post('/api/sync/run', (req, res) => {
  if (syncState.state === 'running') {
    return res.status(409).json({ error: '同期が実行中です' });
  }
  try {
    assertVaultKey();
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }
  syncState = { state: 'running', lastRun: null, progress: { phase: 'scanning', current: 0, total: 0, currentFolder: '' } };
  runSync().catch(err => {
    // エラーをlastRunに記録
  });
  res.json({ started: true });
});
```

**GET /api/sync/status**

`syncState` をそのまま返す。

```json
{ "state": "running", "progress": { "phase": "uploading", "current": 45, "total": 200, "currentFolder": "キャラA" } }
```

または

```json
{ "state": "idle", "lastRun": { "finishedAt": "...", "uploaded": 200, "skipped": 50, "failed": 2, "errors": ["hash abc123: upload failed (503)"] } }
```

#### 1-5: 同期パイプライン（runSync）
1. `data/sync.json` の `folders` から選択フォルダの画像（子フォルダ含む）をSQLiteで列挙する。SQLの完全一致・子フォルダ接頭辞判定はLIKEワイルドカードを使わない。未選択ならuploaded:0で正常完了。
2. `CLOUD_BASE` とBearer `CLOUD_TOKEN` で `GET /api/prompt-vault/sync/images`（ページング500件）を呼び、既存hashと `deleted_at` を取得する。認証失敗・容量取得失敗ではデータ送信せず、秘密を除いた理由を `lastRun.errors` に記録する。
3. `GET /api/prompt-vault/sync/r2-usage` と既存settingsの `'sync.r2_limit_gb'`（既定5）で容量を確認。超過見込みならその回の上りを送らない。
4. `data/sync-webp-state.json` から同期機構によるWebP本体+サムネイルの送信成功hashを読み込む（未作成なら空）。クラウドに**未登録**または**存在するが成功記録なし**の画像を対象とする。成功記録あり＋クラウドに存在すればskip。削除済み `deleted_at` の画像は復活させない。これにより**既存約400枚の選択対象も暗号化WebPに上書き**する。
5. PNGをsharpで原寸WebP q80と長辺320px WebP q80サムネに変換。`src/lib/crypto.js` と同じ `[keyId長][vault:v1][IV12][ciphertext+tag16]` 形式でAES-256-GCM暗号化。`PUT /api/prompt-vault/sync/upload-image` に `Authorization: Bearer <CLOUD_TOKEN>`、`X-PV-Hash`、`X-PV-Meta`（base64 JSON）、multipart `image` で送信する。成功後、`PUT /api/prompt-vault/thumbs/{hash}` へ暗号化サムネイルを送る。Worker側の上書きは既存R2キーとD1のupsertを使う。
6. **両アップロード成功後だけ** `data/sync-webp-state.json` にhashを追加し原子的に記録する。1件失敗しても他の画像は継続、失敗hashは次回再試行する。後から選択したフォルダでも同じ規則とし、毎回全件送信しない。
7. `GET /api/sync/status` にscanning/uploading/cleanupと進捗を報告し、完了時にuploaded/skipped/failed/errors（最大20）を残す。クラウド画像削除、定期同期、逆同期、cards/presets/settings同期は行わない。

#### 1-6: server.jsへのルーティング追加

`server.js` に同期APIのルーティングを追加する。既存エンドポイントの変更は行わない。

```javascript
import { setupSyncRoutes } from './server/sync.js';
// ... 既存のルーティング後に追加
setupSyncRoutes(app, db); // app: Expressインスタンス, db: better-sqlite3インスタンス
```

またはexpressRouter形式でもよい。既存のルーティング構造に合わせること。

#### 1-7: 環境変数の追加
`.env.example` に `PV_VAULT_KEY=`、`CLOUD_TOKEN=`、`CLOUD_BASE=`、`PV_SYNC_SECRETS_PATH=` の4キーを**空値で**追加する。実値を公開ファイルに置かない。実際の秘密は `D:\\AI\\secrets\\secrets.env` のうち上記の3キーだけを `server/sync.js` が読み込む。既存起動スクリプトは改変禁止。秘密なしで起動でき、同期時503を確認する。
---


### Part 2: フロントUI（src/）

#### 2-1: フォルダ選択UI（SettingsScreen.jsx）

設定画面に「クラウド同期」セクションを追加する。**フラン接続時のみ表示**する。

```jsx
{connectionRoute === 'fran' && (
  <section>
    <h3>クラウド同期</h3>
    <SyncFolderSelector />
    <SyncButton />
  </section>
)}
```

**SyncFolderSelector** コンポーネント（SettingsScreen内またはcomponents/に新設）:

- 画面表示時に `GET /api/sync/folders` を呼ぶ
- 各フォルダをチェックボックスで表示（フォルダ名 + 画像枚数）
- チェック変更はローカルstateに保持
- 「保存」ボタンで `PUT /api/sync/folders` を呼ぶ
- D-5: 最上位フォルダ単位。子フォルダの個別選択UIは設けない

#### 2-2: 同期ボタンと進捗表示

**SyncButton** コンポーネント:

1. 「同期」ボタンを表示
2. ボタン押下で `POST /api/sync/run` を呼ぶ
3. 同期中（state=running）:
   - ボタンをdisabledにする
   - 2〜3秒間隔で `GET /api/sync/status` をポーリング
   - プログレスバー（current / total）と `currentFolder` を表示
4. 同期完了（state=idle, lastRun != null）:
   - ポーリングを停止
   - アップロード数・スキップ数・エラー数を表示
5. エラー時:
   - vault key未設定（503）: 「vault鍵が設定されていません」とトースト表示
   - `lastRun.errors` が空でない場合: エラー件数を表示

```jsx
// ポーリング例
useEffect(() => {
  if (!polling) return;
  const id = setInterval(async () => {
    const res = await fetch('/api/sync/status');
    const data = await res.json();
    setSyncStatus(data);
    if (data.state === 'idle') {
      setPolling(false);
    }
  }, 2500);
  return () => clearInterval(id);
}, [polling]);
```

#### 2-3: 表示制約

- フラン接続時（`connectionRoute === 'fran'`）のみ「クラウド同期」セクションを表示
- クラウド接続時・オフライン時は非表示
- 既存のFran専用UI非表示ルール（boundary-batch Part 2 §2-2で導入済み）に準じる

---

### Part 3: バグ修正（B-1〜B-3）

#### 3-1: B-1 — ビューアのローディング停滞（サムネイル404時）

**現象**: サムネイル取得が404で失敗するとローディングが解除されない。

**修正箇所**: `src/components/ImageViewer.jsx` のサムネイル404処理（PG調査に基づく追加変更許可）。

**修正方針**:

```javascript
// サムネイルフェッチのcatch/errorハンドリング
try {
  const thumbUrl = await api.getThumb(hash);
  setThumbSrc(thumbUrl);
} catch (err) {
  // 404を含むすべてのエラーでローディング状態を解除
  setLoading(false);
  setThumbSrc(null); // プレースホルダー表示にフォールバック
  // エラーを記録（C-2）
  recordInvalid({
    kind: 'thumb-fetch-failed',
    stage: 'B-1 viewer-thumb-load',
    raw: `hash=${hash} status=${err.status ?? 'unknown'}`,
    reason: err.message,
  });
}
```

既存のローディング状態管理の場所に応じて、具体的な修正箇所は異なる。ローディング表示が `isLoading` stateで制御されている場合は、エラー時に `setIsLoading(false)` を確実に呼ぶ。

#### 3-2: B-2 — 新規画像のフォルダプレビュー空表示

**現象**: `thumb_ok=0` の画像しかないフォルダでFolderCardのプレビューが空になる。

**修正方針**: FolderCardのプレビューサムネイル取得で、`thumb_ok=0` の画像についてもフォールバック表示を行う。

選択肢（既存コードの構造に応じて選ぶ）:
- A: `thumb_ok=0` の画像についてプレースホルダー画像を表示する
- B: `thumb_ok=0` の画像はフルサイズ画像からclient-sideでサムネイルを生成する（既存の `generateCloudThumbnail` 関数を利用）

Aが最小変更。Bが理想だが、既存コードとの整合を確認して判断する。判断が困難な場合は停止して報告する。

#### 3-3: B-3 — Blob URLの未解放によるメモリ圧迫

**現象**: `URL.createObjectURL()` で生成したBlob URLが解放されず、モバイル端末のメモリを圧迫する。

**修正方針**: サムネイル表示コンポーネントで、アンマウント時（またはsrc変更時）に `URL.revokeObjectURL()` を確実に呼ぶ。

```jsx
// useEffectでクリーンアップ
useEffect(() => {
  return () => {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
  };
}, [blobUrl]);

// src変更時にも旧URLを解放
useEffect(() => {
  return () => {
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current);
    }
  };
}, [thumbSrc]);
```

修正対象となるコンポーネント（Blob URLを生成するすべての箇所）:
- FolderCard内のPreviewThumb（boundary-batchで追加）
- ビューア内の画像表示
- AlbumScreen内のサムネイルグリッド

batch2指示書の規定「Blob URLはメモリリークの原因になる。コンポーネントのunmount時またはURL不要時に `URL.revokeObjectURL()` を必ず呼ぶ」を徹底する。

---

### Part 4: ai-family-foundation（従作業）

#### 4-1: pv-sync.mjs の物理削除延期（S-2）
本件では `ai-family-foundation/scripts/pv-sync.mjs` を**削除しない**。2026-09-22からfire-runnerで停止中の旧ジョブを再開しない。旧実体・16 verifier・2 fixture・共有ライブラリはそのまま保持し、未コミット別作業に触れない。実体削除と旧検証器の整理は新同期稼働確認後の別Issue/別指示書とする。

#### 4-2: Worker側の変更確認

同期パイプライン（Part 1-5）で使用する画像アップロードのWorkerエンドポイントを確認する。旧pvImageUpが呼んでいたエンドポイントと同じものを使用する。

エンドポイントが不明な場合、以下を手がかりに特定する:
- `scripts/pv-sync.mjs`（削除前に確認）の `pvImageUp` 関数内のfetch先
- Worker の `functions/api/prompt-vault/` 配下のルーティング

Worker側のコード変更が必要な場合は最小限にとどめる。暗号化バイナリとして受け取るため、PNGからWebPへの変更でWorker側に影響はないはず。影響がある場合は停止して報告する。

---

### コミット指針

#### prompt-vault-dev

```
feat(#115): add server-side sync module with folder selection and manual trigger

- Add server/sync.js with AES-256-GCM encryption (same format as crypto.js)
- Add sync API endpoints: GET/PUT /api/sync/folders, POST /api/sync/run, GET /api/sync/status
- Add folder selection and sync button UI in SettingsScreen (Fran-only)
- Fix B-1: viewer loading state on thumbnail 404
- Fix B-2: folder preview for images with thumb_ok=0
- Fix B-3: revoke Blob URLs on component unmount
```

#### ai-family-foundation

本件ではfoundation側コードの変更コミットは不要。Worker契約・旧ジョブ停止・verifier維持の照合結果を完了報告に記す。

---

## 禁止事項

- 新画面の追加（同期設定は既存SettingsScreen内のセクション追加のみ）
- vault keyのログ出力・エラーメッセージへの含有（J-3）
- クラウド側の画像削除（D-3: 同期対象外でも削除しない）
- 自動定期同期の実装（D-4: 手動ボタンのみ）
- handback（Cloud→Fran逆同期）の実装（スコープ外）
- cards/presets/settingsの同期（スコープ外）
- `NOVELAI_API_KEY` 等の鍵をソースコードや `.env.example` にハードコードすること
- 既存エンドポイントの変更・削除

---

## 検証計画（受入基準との対応・これが検収の正になる）

| AC | 検証項目（手順） | 手段 | 証跡様式 | negative control |
|---|---|---|---|---|
| AC-1 | GET /api/sync/folders → フォルダ一覧と画像数が返る | PG実行（curl） | 生ログ | 該当なし |
| AC-2 | PUT /api/sync/folders → 既存PUT /api/settings → GET再取得で選択状態保持 | PG実行（curl） | 生ログ | 有（旧方式で消失） |
| AC-3 | PV_VAULT_KEY未設定で POST /api/sync/run → 503が返る | PG実行（curl） | 生ログ | 有（鍵設定時は200で開始） |
| AC-4 | 同期中に POST /api/sync/run → 409が返る | PG実行（curl） | 生ログ | 有（idle時は200で開始） |
| AC-5 | 選択フォルダなしで同期 → uploaded:0で正常完了 | PG実行（curl） | 生ログ | 該当なし |
| AC-6 | サーバー暗号化→フロントdecrypt()→元バイナリ一致 | PG実行（テストコード） | テスト出力 | 有（不正鍵で復号失敗） |
| AC-7 | B-1: サムネイル404時にローディングが解除される | PG実行（テストまたはブラウザ） | テスト出力 | 有（404前はローディング表示） |
| AC-8 | B-2: thumb_ok=0のフォルダでプレビューが表示される | PG実行（テストまたはブラウザ） | テスト出力 | 該当なし |
| AC-9 | B-3: コンポーネントunmount時にrevokeObjectURL呼出 | PG実行（console.logまたはテスト） | テスト出力 | 有（unmount前は未解放） |
| AC-10 | npm run build 成功 | PG実行 | 生ログ | 該当なし |
| AC-11 | npm run inspect 既存赤以外に新規赤なし | PG実行 | 生ログ | 該当なし |
| AC-12 | npm run verify:issues 既存結果維持（両リポジトリ） | PG実行 | 生ログ | 該当なし |
| AC-13 | 既存hashのWebP上書きと復号 | PG実行 | 生ログ | 有（旧差分のみ） |
| AC-14 | 再同期skip・失敗再送・後選択フォルダ上書き | PG実行 | 生ログ | 有（失敗注入） |
| AC-15 | secretなし通常起動、同期503、有効認証200、無効認証送信停止 | PG実行 | マスク済み生ログ | 有 |
| AC-16 | foundation verifier維持、旧ジョブ停止 | PG実行 | 生ログ・diff | 有 |
| AC-17 | 設定保存・再起動後の同期状態保持 | PG実行 | 生ログ | 有（従来方式） |

- negative controlは「旧バグ相当で赤の記録→修正後に緑」の両方を証跡に残す
- **実機系（発注者に依頼）**: フラン設定画面でのフォルダ選択→同期実行→Pixel端末でのクラウド閲覧確認、B-1/B-2実機確認、フラン回帰テスト

---

## 完了条件

- server/sync.jsが新設され、vault keyの読み込み・暗号化・同期パイプラインが仕様どおり動作すること
- 同期API（GET/PUT /api/sync/folders、POST /api/sync/run、GET /api/sync/status）が仕様どおり動作すること
- 暗号化バイナリがsrc/lib/crypto.jsのdecrypt()で復号できること（暗号文フォーマット互換）
- SettingsScreenにフォルダ選択UIと同期ボタンが追加され、フラン接続時のみ表示されること
- B-1（ビューアローディング停滞）が修正されていること
- B-2（フォルダプレビュー空表示）が修正されていること
- B-3（Blob URL未解放）が修正されていること
- 旧pv-sync.mjsは物理削除せず運用停止継続し、foundation既存verifier/fixtureを保つこと（最終削除は別Issue）
- 検証計画の全項目を実行し、証跡を完了報告に添付済み
- 操作スクリプト納品（起動・環境構築・検証はbat/sh＋.env.exampleで自己完結。発注者にコンソール操作をさせない）・サーバー再起動・pull・push実施済み
- inspect緑・_STATUS.mdフロントマター更新

---

## 報告基準

報告は docs/reports/report-pv-115-cloud-sync.md に置く（AC対応表様式）。チャット発話は定型③または④のみ。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約
2. **AC対応表**: | AC | 検証項目 | 結果 | 証跡（生ログ引用 or reports/内パス） |
3. inspect結果（緑/赤と出力の添付）・CI run URL
4. 完了条件の各項に対する充足状況
5. 未完了・未検証の項目があれば列挙（#012・美化しない）
6. 発注者指示による仕様外修正があればその旨と内容
7. サーバー再起動・コミット・プッシュの実施状況
8. Workerデプロイ要否の判定・画像アップロードのWorkerエンドポイント特定結果（Part 4-2）

---

## 発令文（PMがpush後チャットへ転写する）

```
【発令】prompt-vault v4.2.0 — クラウド改修（フォルダ選択同期・画像軽量化・B-1〜B-3）
作業: フランサーバーに同期モジュールを内蔵し、選択フォルダの画像をWebP変換・暗号化してクラウドへ転送する仕組みを構築する
リポジトリ: prompt-vault-dev（指示書・報告）＋ ai-family-foundation（Worker） ／ Issue: pv#115
手順: 両リポジトリで git pull → prompt-vault-dev の docs/instructions/instructions-pv-115-cloud-sync.md を読む
      → マニフェスト照合・inspect緑を確認して着工
報告先: prompt-vault-dev の docs/reports/report-pv-115-cloud-sync.md（AC対応表様式）
```

--------
