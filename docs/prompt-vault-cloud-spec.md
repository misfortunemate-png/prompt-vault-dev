# prompt-vault クラウド改修 実装仕様書
文書種別: 権威文書

作成日: 2026-10-25
技術顧問: クリーデ
承認済み要件定義: docs/prompt-vault-cloud-requirements-approved.md
対応Issue: prompt-vault-dev #115

## 1. 概要

- **何を作るか**: フランのprompt-vaultサーバーに同期モジュールを内蔵し、ユーザーが選択したフォルダの画像をWebP形式に変換・暗号化してクラウドへ転送する仕組みを構築する。フロントに同期操作UIとバグ修正を加える
- **なぜ作るか**: 2026年9月22日に旧同期ジョブ（pv-sync）が除去されて以降、フラン→クラウドの画像同期が停止している。約3,000枚の未同期画像があり、モバイルでの閲覧も重い。本改修で同期を再開し、フォルダ選択による範囲制御と画像軽量化により、実用的なクラウド閲覧環境を実現する
- **誰が使うか**: 発注者（Pixel端末からのクラウドモード閲覧）

---

## 2. 設計判断（承認済み）

要件定義で発注者が決定した設計判断を仕様に反映する。

| # | 決定事項 | 決定内容 | 仕様への影響 |
|---|----------|----------|--------------
| D-1 | 表示用画像フォーマット | WebP q80、原寸 | §4 同期パイプラインの変換仕様 |
| D-2 | クラウドのオリジナルPNG | 保持しない。上書き・削除可 | §5 R2上の既存暗号化PNGの扱い |
| D-3 | 同期対象外フォルダのクラウド側 | 削除しない | §4 差分同期ロジックの設計 |
| D-4 | 同期トリガー | 手動ボタンのみ | §6 フロントのSync UI |
| D-5 | 子フォルダの継承 | 最上位フォルダ単位 | §4 フォルダ選択の粒度 |
| D-6 | クラウド生成画像 | スコープ外 | 本仕様では扱わない |
| D-7 | 同期の実行主体 | フランのprompt-vaultサーバー | §3 同期モジュールの所在 |
| S-1 | 既知不具合 | B-1〜B-3をスコープに含む | §7 バグ修正 |

---

## 3. フラン側の変更（prompt-vault-dev server/）

prompt-vaultサーバーに同期モジュールを新設する。旧pv-sync（ai-family-foundation scripts/pv-sync.mjs）の画像転送機能をサーバー内蔵に移し、外部スクリプトとfire-runnerへの依存を解消する。

### §3.1 同期モジュールの構成

`server/sync.js` を新設する。責務は以下の三つ。

1. **フォルダ選択の管理** — 同期対象フォルダの保存・取得
2. **同期の実行** — 画像変換・暗号化・アップロードの一連のパイプライン
3. **進捗の報告** — 同期中の進捗状態の保持と提供

### §3.2 フォルダ選択の保存

同期対象フォルダは `data/sync.json` に独立保存する。既存の `PUT /api/settings` は `data/settings.json` を全置換するため、そこに同期選択を混在させない（停止報告S-1のPM裁定）。

```json
{
  "folders": ["キャラA", "キャラB"]
}
```

- `folders`: 同期対象の最上位フォルダ名の配列。空配列は「未選択」。未作成時は空配列とみなす
- `data/sync.json` は原子的に更新し、同期中の読み取りおよび設定保存との競合で内容を失わない
- R2上限は従来の `data/settings.json` のフラットキー `'sync.r2_limit_gb'` を読み、存在しなければ5GBを用いる。同期選択ファイルに混在させない
- フォルダ名はギャラリーインデックス（SQLite `images` テーブルの `folder` 列）の最上位セグメントに対応する
- D-5により、子フォルダは自動的に含まれる。例: `"キャラA"` を選択すると `キャラA/サブフォルダ` 配下の画像もすべて対象

### §3.3 同期用APIエンドポイント（フラン側）

| メソッド | パス | 役割 |
|----------|------|------|
| GET | `/api/sync/folders` | 利用可能なフォルダ一覧と選択状態を返す |
| PUT | `/api/sync/folders` | 同期対象フォルダを保存する |
| POST | `/api/sync/run` | 手動同期を開始する |
| GET | `/api/sync/status` | 同期の進捗状態を返す |

**GET /api/sync/folders**

ギャラリーインデックスから最上位フォルダの一覧を取得し、`sync.folders` の選択状態とあわせて返す。

```json
{
  "folders": [
    { "name": "キャラA", "selected": true, "imageCount": 1200 },
    { "name": "キャラB", "selected": false, "imageCount": 800 },
    { "name": "その他", "selected": false, "imageCount": 150 }
  ]
}
```

`imageCount` はそのフォルダ（子フォルダ含む）の画像数。SQLiteの `images` テーブルから集計する。

**PUT /api/sync/folders**

リクエスト: `{ "folders": ["キャラA", "キャラB"] }`

`data/sync.json` の `folders` を上書き保存する。存在しないフォルダ名が含まれていた場合は無視して保存する（C-1: invalid集約先に記録）。既存の `PUT /api/settings` / `validateSettings` は変更しない。

**POST /api/sync/run**

同期を開始する。同期が既に実行中の場合は `409 Conflict` を返す。

レスポンス: `{ "started": true }`

同期はバックグラウンドで実行される。クライアントは `GET /api/sync/status` でポーリングして進捗を確認する。

**GET /api/sync/status**

```json
{
  "state": "idle",
  "lastRun": null
}
```

```json
{
  "state": "running",
  "progress": {
    "phase": "uploading",
    "current": 45,
    "total": 200,
    "currentFolder": "キャラA"
  }
}
```

```json
{
  "state": "idle",
  "lastRun": {
    "finishedAt": "2026-10-25T12:00:00.000Z",
    "uploaded": 200,
    "skipped": 50,
    "failed": 2,
    "errors": ["hash abc123: upload failed (503)"]
  }
}
```

`state` は `"idle"` または `"running"` の二値。`phase` は `"scanning"`, `"uploading"`, `"cleanup"` のいずれか。

### §3.4 同期パイプライン

同期の実行は以下の手順で進む。

**手順1: 対象画像の列挙（scanning）**

1. `data/sync.json` の `folders` から選択済みフォルダを取得
2. SQLiteの `images` テーブルから、選択済みフォルダ（子フォルダ含む）に属する画像のハッシュ一覧を取得
3. クラウドの同期API（`GET /api/prompt-vault/sync/images`）から既存画像のハッシュ・`deleted_at` を取得（ページング対応、最大500件ずつ）
4. `data/sync-webp-state.json` に、今回の機構がWebP本体とサムネイルを正常送信済みのハッシュを記録する（初期値は空集合、原子的に永続化）
5. 選択フォルダ内で、クラウドに未登録のハッシュ、またはクラウドに存在しても送信成功記録のないハッシュを転送対象とする。後者は既存の暗号化PNGをWebPに上書きするためである。送信済み記録があってもクラウド上で欠けていれば再送対象とする
6. 明示削除済み（`deleted_at` あり）のハッシュは、同意なく再生成・復活させず、今回の同期では除外する

各画像について本体とサムネイルの両方が成功した後にのみ送信済み記録を残す。片方でも失敗した場合は次回再試行する。状態ファイルとフォルダ選択ファイルは分離して、保存操作の競合による記録喪失を防ぐ。

D-3（削除しない）により、クラウドにあってフランの選択フォルダにない画像はそのまま残す。同期は追加・既存PNGからWebPへの置換のみのFran→Cloud片方向である。

**手順2: 画像変換・暗号化・アップロード（uploading）**

差分画像の各ハッシュについて、以下を順に実行する。

1. ディスクからPNGを読み込む（`VAULT_ROOT` 配下のパス）
2. sharpでWebP品質80に変換する（原寸、リサイズなし。D-1）
3. sharpでサムネイルを生成する（長辺320px、WebP品質80）
4. 表示用WebPをAES-256-GCMで暗号化する（§3.5）
5. サムネイルをAES-256-GCMで暗号化する
6. 暗号化WebPをクラウドWorkerにアップロードする
7. 暗号化サムネイルをクラウドWorkerにアップロードする（`PUT /thumbs/{hash}`）
8. D1メタデータの更新（folder, filename, preset_id, created_at等）

1件の失敗で全体を中断しない。エラーを記録し、次の画像に進む。完了後に `lastRun` にエラー一覧を残す。

**手順3: 進捗の報告**

`uploading` フェーズ中、1件アップロードするごとに `progress.current` を更新する。フロントはポーリング（2〜3秒間隔を推奨）で取得する。

### §3.5 暗号化の実装（Node.js）

フロントの `src/lib/crypto.js` と同一のAES-256-GCM暗号文フォーマットを、Node.jsの `crypto` モジュールで実装する。

**暗号文フォーマット（crypto.jsと同一）:**

```
[1byte: key_id長][key_id UTF-8][12bytes: IV][残り: ciphertext + 認証tag(16bytes)]
```

**Node.js実装の要点:**

```javascript
import { createCipheriv, randomBytes } from 'node:crypto';

function encrypt(plainBuffer, keyBuffer, keyId = 'vault:v1') {
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

- `keyId` はフロントと同じ `'vault:v1'` を使用する
- フロントのWeb Crypto APIでは `ciphertext` にtagが結合されて返る。Node.jsでは `cipher.getAuthTag()` で別途取得し、末尾に連結する。結果のバイト列はフロントの `decrypt()` でそのまま復号できる
- IVは毎回ランダム生成する（12バイト）

### §3.6 vault keyの読み込み

vault key（AES-256の生鍵、32バイト）とクラウド接続情報は、同期モジュールが必要な値だけを安全に取得する（停止報告S-3のPM裁定）。

```
PV_VAULT_KEY=<base64エンコードされた32バイト鍵>
```

- `server/sync.js` は `process.env` を優先し、未設定の値に限り `D:\\AI\\secrets\\secrets.env`（`PV_SYNC_SECRETS_PATH` でパス変更可）から **`PV_VAULT_KEY`、`CLOUD_TOKEN`、`CLOUD_BASE` の3項目だけ**を読み取る。Node.js v24の `node:util` `parseEnv` 相当で解析し、ファイル内の他の値は環境全体に展開しない。ファイルがなければ通常起動は継続する
- `CLOUD_BASE` の既定値は従来の同期先 `https://ai-family-foundation.misfortunemate.workers.dev` とし、`CLOUD_TOKEN` は従来のpv-syncで有効だったトークンを同名で再利用する。`FA_TOKEN_MACHINE` を、権限が検証されないまま暗黙に代用しない
- `CLOUD_TOKEN` が欠ける／Workerから401・403が返る場合は送信を始めず、秘密値を含めない同期エラーを返す。インフラPGが既存の有効トークンをprivate secretsに配置し、GET `/api/prompt-vault/sync/images` の認証成功（200）を確認する。必要な秘密の現物値はリポジトリや報告に書かない
- `PV_VAULT_KEY` は読み取った後Base64デコードし、32バイトであることを検証する。鍵の読み込み失敗でも他のサーバー機能は起動できる
- 未設定の場合、同期APIは `503 Service Unavailable` を返す（同期不可の旨をメッセージに含める）
- 鍵の値はログやエラーメッセージに含めない（J-3準拠）
- フロントのlocalStorage `pv-vault-key` に設定されている鍵と同一の鍵である必要がある。鍵の同一性はユーザーの責任で管理する

### §3.7 R2容量チェック

同期開始時にクラウドのR2使用量を確認し、`sync.r2_limit_gb`（既定5GB）を超過する見込みの場合はその回の全アップロードをスキップする。これは既存のpvImageUpと同じ挙動を踏襲する。

表示用WebP化（平均102KB）により全3,744枚でも推定370MBであり、通常運用では5GBに到達しない。

---

## 4. クラウドWorker側の変更（ai-family-foundation）

### §4.1 画像アップロードエンドポイント

旧pv-syncのpvImageUpが使用していた画像アップロードのWorkerエンドポイントを、フランサーバーからのリクエストでも利用する。エンドポイントの仕様自体に変更はない。暗号化済みバイナリを受け取り、R2に保存し、D1にメタデータを記録する。

転送される画像がPNGからWebPに変わるが、Worker側では暗号化バイナリとして扱うため（Worker側で復号しない）、コンテンツ形式の変更による影響はない。

### §4.2 既存データの移行（D-2）

R2上の既存の暗号化PNG（約400枚、初回同期時の2026年9月2日アップロード分）は、保全不要と決定されている。以下の方針で扱う。

- 同期対象フォルダに含まれる既存ハッシュは、`data/sync-webp-state.json` に送信成功記録がなければ初回に暗号化WebPで上書きする。後から選択されたフォルダの既存PNGも同じ基準で処理する。成功記録を残した画像は次回差分同期でスキップし、クラウドから欠けていれば再送する
- 同期対象フォルダに含まれない画像は上書きされずにR2に残る。D-3（削除しない）により、明示的な削除は行わない
- 結果として、R2には新しいWebPと古いPNGが混在しうる。フロントの表示パイプラインはどちらも暗号化バイナリとして復号→Blob URLで表示するため、混在しても表示に支障はない

D1のメタデータ（hash, filename, folder等）は同期時に最新のフラン側データで更新される。

### §4.3 D1スキーマの変更

D1の `pv_images` テーブルへのカラム追加は不要。既存カラム（hash, filename, folder, created_at, preset_id, caption, favorite, thumb_ok, deleted_at等）で同期メタデータを表現できる。

### §4.4 同期契約の更新

旧同期契約v1.0（ai-family-ops docs/20260910_pv-sync-contract_v1.0.md）は、pv-sync.mjsのpush/handback二操作を前提としている。本改修で同期の実行主体がフランサーバーに移るため、同期契約の改訂が必要になる。

改訂の要点:
- 実行主体: pv-sync.mjs（fire-runner経由） → prompt-vault server/sync.js（サーバー内蔵）
- 方向: push/handback二操作 → Fran→Cloud片方向のみ（handbackは廃止。Cloud→Franの逆同期はスコープ外）
- トリガー: fire-runner定期実行 → ユーザー手動（POST /api/sync/run）
- 転送形式: 暗号化PNG → 暗号化WebP（q80原寸）

同期契約の改訂文書はPMが作成し、ai-family-opsに格納する。

---

## 5. 旧pv-syncの廃止

### §5.1 廃止対象

ai-family-foundation リポジトリの `scripts/pv-sync.mjs` を廃止する。2026年9月22日にfire-runnerから除去済みであり、本改修で同期機能がフランサーバーに内蔵されることで、スクリプトとしての役割を終える。

### §5.2 廃止の手順

1. **本件では `scripts/pv-sync.mjs` を削除しない**。既にfire-runnerから撤去され、自動実行されないことを確認して従来どおり不使用とする（停止報告S-2のPM裁定）
2. 参照するverifier 16本・fixture 2本・共有ライブラリは変更・無効化せず、foundation既存検査の緑を維持する。foundation側の未コミット別件作業10ファイルには触れない
3. 旧ファイルと関連検査の最終撤去は、フラン同期の稼働・検収後に別Issue・別指示書で扱う。旧スクリプトを手動で起動する運用は再開しない
4. 同期契約v1.0の改訂（§4.4）は別途PMの文書作業とし、本件PGの完了条件を阻害しない

### §5.3 handbackの扱い

旧pv-syncのhandback操作（Cloud→Fran逆同期）は本改修で再実装しない。要件定義のスコープ外（「クラウドからフランへの逆方向同期」は除外）のため。将来必要になった場合は別の要件として検討する。

---

## 6. フロント側の変更（prompt-vault-dev src/）

### §6.1 フォルダ選択UI

設定画面（SettingsScreen.jsx）に「クラウド同期」セクションを追加する。フラン接続時のみ表示する。

**表示内容:**

- 最上位フォルダの一覧（チェックボックス付き）
- 各フォルダの画像枚数
- 「保存」ボタン

**動作:**

1. 画面表示時に `GET /api/sync/folders` を呼び、フォルダ一覧と選択状態を取得
2. チェックボックスの変更をローカルstateに保持
3. 「保存」ボタンで `PUT /api/sync/folders` を呼び、選択を確定

**制約:**

- D-5: 最上位フォルダ単位の選択のみ。子フォルダの個別選択UIは設けない
- クラウド接続時はこのセクション全体を非表示にする（フラン接続時にのみ同期設定が意味を持つ）

### §6.2 手動同期ボタン

「クラウド同期」セクション内に同期実行ボタンを配置する（D-4: 手動ボタンのみ）。

**表示内容:**

- 「同期」ボタン
- 同期中: プログレスバー（current / total）と現在処理中のフォルダ名
- 同期完了後: 結果サマリー（アップロード数、スキップ数、エラー数）

**動作:**

1. ボタン押下で `POST /api/sync/run` を呼ぶ
2. 同期中は2〜3秒間隔で `GET /api/sync/status` をポーリングし、プログレスバーを更新
3. `state` が `"idle"` に戻ったらポーリングを停止し、`lastRun` の結果を表示
4. 同期中はボタンをdisabledにする

**エラー表示:**

- `lastRun.errors` が空でない場合、エラー件数をトースト通知する。詳細はサマリーに表示
- vault key未設定（503）の場合、「vault鍵が設定されていません」とトースト表示

### §6.3 表示制約

- フラン接続時のみ「クラウド同期」セクションを表示する
- クラウド接続時は非表示（§2-2の既存Fran専用UI非表示ルールに準じる）
- オフライン時も非表示

---

## 7. バグ修正（S-1: B-1〜B-3）

要件定義で本改修のスコープに含めると決定された不具合3件を修正する。

### §7.1 B-1: ビューアのローディング停滞（サムネイル404時）

**現象**: サムネイルの取得が404で失敗すると、ビューアのローディング表示が解除されず操作不能になる。

**原因**: サムネイルフェッチのエラーハンドリングで、404時にローディング状態をリセットしていない。

**修正方針**: サムネイルフェッチのエラー時（404含む）にローディング状態を解除し、プレースホルダーまたはフルサイズ画像へのフォールバックを試みる。

### §7.2 B-2: 新規画像のフォルダプレビュー空表示

**現象**: サムネイルが未生成の新規画像しかないフォルダで、フォルダプレビュー（FolderCard）が空になる。

**原因**: フォルダプレビューのサムネイル取得が、`thumb_ok=0` の画像をスキップしている（または取得に失敗してフォールバックがない）。

**修正方針**: `thumb_ok=0` の画像についても、フルサイズ画像からのプレビュー生成を試みる。または、サムネイル未生成を示すプレースホルダーを表示する。

### §7.3 B-3: Blob URLの未解放によるメモリ圧迫

**現象**: グリッド表示のサムネイルキャッシュで生成したBlob URLが解放されず、長時間のブラウジングでモバイル端末のメモリを圧迫する。

**原因**: `URL.createObjectURL()` で生成したBlob URLに対応する `URL.revokeObjectURL()` がコンポーネントのアンマウント時に呼ばれていない。

**修正方針**:
- サムネイルを表示するコンポーネントのアンマウント時（またはsrc変更時）に `URL.revokeObjectURL()` を確実に呼ぶ
- IntersectionObserverによるlazy loadを使用している場合、画面外に出た画像のBlob URLも解放を検討する
- batch2指示書（手順2）の「Blob URLはメモリリークの原因になる。コンポーネントのunmount時またはURL不要時に `URL.revokeObjectURL()` を必ず呼ぶ」の規定を徹底する

---

## 8. テスト方針

### 8.1 PG自己完結テスト

| # | テスト対象 | 方法 | 合格条件 |
|---|-----------|------|----------|
| 1 | フォルダ選択API | `GET /api/sync/folders` をcurlで呼ぶ | フォルダ一覧と画像数が返る |
| 2 | フォルダ保存 | `PUT /api/sync/folders` でフォルダを選択→既存 `PUT /api/settings` による生成設定保存→再取得 | 選択状態が保持され、既存設定保存も壊れない |
| 3 | 同期実行（空転） | 選択フォルダなしで `POST /api/sync/run` | `state` が `running` → `idle` に遷移し、`uploaded: 0` |
| 4 | 暗号化互換性 | サーバーで暗号化したバイナリをフロントの `decrypt()` で復号 | 元のバイナリと一致 |
| 5 | vault key未設定 | `PV_VAULT_KEY` 未設定で `/api/sync/run` | 503が返る |
| 6 | 二重実行防止 | 同期中に再度 `POST /api/sync/run` | 409が返る |
| 7 | ビルド | `npm run build` | エラーなし |
| 8 | 検査 | `npm run inspect` | 既存赤以外に新規赤なし |
| 9 | Issue verifier | `npm run verify:issues` | 既存結果を維持 |
| 10 | B-3 Blob URL | コンポーネントアンマウント後に `URL.revokeObjectURL` が呼ばれること | テストコードまたはconsole.logで確認 |

**停止報告への追加検証（PG自己完結）**: (A) `CLOUD_TOKEN` 未設定・鍵未設定での安全な失敗と非漏洩、(B) Worker認証における有効トークンの200・無効トークンの401/403、(C) 既存クラウドhashの上書きとWebP復号、(D) 送信済みhashの再同期スキップ、(E) 同期途中失敗後の再試行、(F) 新たに選択したフォルダの既存クラウドhashの上書き、(G) 既存の明示削除済み画像を復活させないこと、(H) foundation verifierを壊さず旧スクリプトが自動起動されないこと。実クラウドの更新は安全なテスト対象と認証が確保されるまで実施しない。生ログ・negative controlを報告へ添付する。

### 8.2 実機テスト（発注者依頼）

| # | テスト対象 | 方法 | 合格条件 |
|---|-----------|------|----------|
| 11 | 同期の実行 | フランの設定画面でフォルダを選択→同期ボタン押下 | 進捗表示が更新され、完了後にアップロード数が表示される |
| 12 | クラウド閲覧 | Pixel端末でクラウドモードのアルバムを開く | 同期した画像がWebPで表示される（PNG時より高速） |
| 13 | B-1 確認 | サムネイルがない画像をビューアで開く | ローディングが停滞しない |
| 14 | フラン回帰 | フラン接続で全既存機能 | 従来どおり動作 |

### 8.3 統合テスト（Workerデプロイ後）

- クラウドWorkerへの画像アップロード（暗号化WebP）
- D1メタデータの正確な反映
- 既存暗号化PNGとの混在環境での表示

---

## 9. 作業範囲の整理

本改修は二つのリポジトリにまたがる。

| リポジトリ | 作業内容 | 規模 |
|-----------|----------|------|
| prompt-vault-dev | 同期モジュール新設（server/sync.js）、フォルダ選択UI、同期ボタン、B-1〜B-3修正 | 主作業 |
| ai-family-foundation | Workerエンドポイント確認のみ。旧pv-sync.mjsの物理削除とverifier退役は別Issueに延期 | 従作業 |

指示書はリポジトリ単位で分離するか、一枚にまとめるかはPMの判断に委ねる。

### 9.1 既存機能への影響

- **フラン接続モード**: 同期モジュールが追加されるが、既存のギャラリー・生成・テンプレート機能には影響しない
- **クラウド接続モード**: 表示パイプラインの変更なし（暗号化バイナリ→復号→Blob URLの流れは同一）。B-1〜B-3の修正がクラウドモードの表示品質を改善する
- **server.js**: 同期APIのルーティング追加のみ。既存エンドポイントの変更なし

### 9.2 secrets.envの変更

`D:\AI\secrets\secrets.env` に以下の環境変数を追加する。

```
PV_VAULT_KEY=<vault keyのbase64値>
```

vault keyの値はフロントのlocalStorage `pv-vault-key` の `raw` フィールドと同一でなければならない。

---

## 10. スコープ外の明示

以下は本仕様に含まれない。

| 項目 | 理由 |
|------|------|
| Cloud→Fran逆同期（handback） | 要件定義のスコープ外 |
| クラウド生成画像の扱い（D-6） | 発注者判断でスコープ外 |
| 自動定期同期 | D-4で手動のみと決定 |
| R2の既存PNG一括削除 | D-3で削除しないと決定。上書き分のみ自然に置換 |
| cards/presets/settingsの同期 | 旧pv-syncのpush/handback範囲。本改修は画像同期のみ |
| 同期契約v1.0の改訂文書 | PMが別途作成 |

---

## 改訂履歴

| 日付 | 変更内容 |
|------|----------|
| 2026-10-25 | 初版。承認済み要件定義に基づき作成 |
