# 文書種別: 権威文書

# prompt-vault クラウド化 アプリPG指示書 第一便（デバッグ・設定・経路選択）

作成日: 2026-08-26 ／ PM: クリーデ ／ 対応仕様: ai-family-ops docs/prompt-vault-cloud/spec-prompt-vault-cloud-v1.0.md §12〜§17 ／ 本書一枚で完結（追補なし）

## 添付マニフェスト（着工前照合・必須）

以下がすべてリポジトリまたは交換所に存在すること。**1つでも欠けたら着工せず docs/reports/ に報告。**

| # | パス | 種別 | SHA-256 |
|---|---|---|---|
| 1 | ai-family-ops docs/prompt-vault-cloud/spec-prompt-vault-cloud-v1.0.md | 仕様書 | — |
| 2 | ai-family-ops docs/prompt-vault-cloud/api-contract-table-v1.1.md | 契約表 | — |
| 3 | ai-family-ops docs/prompt-vault-cloud/mockups/header-lamp-connection-panel.html | モックアップ | — |

仕様書と契約表はai-family-opsリポジトリ上にある。GitHub API（PATは指示書冒頭に掲示されている）でRaw取得して確認すること。

## PG運用規律（定型・全フェーズ共通）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**: PM支給物はdiffゼロで検収される
3. **発注者指示による仕様外修正**: 発注者から直接指示を受けた修正は実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記する
4. **着工前**: `git pull` → mainブランチを確認

## 作業範囲

- **何を**: フロントにクラウド接続の経路選択・ヘッダーランプ・接続パネル・設定項目を追加する
- **なぜ**: クラウド経路のWorker実装より先に、接続確認とデバッグの基盤を作る。フラン経路は既に動いているので、到達確認とランプ表示はWorker完成前に動作する
- **どこで**: prompt-vault-dev（D:\AI\github\prompt-vault-dev）、mainブランチ

## 作業手順

### 手順1: src/lib/connection.js を新規作成

経路選択と接続状態を管理するモジュール。

**状態**: localStorage `pv-connection` に保存。

```javascript
// 状態の型
// { route: 'fran'|'cloud'|'offline', manual: boolean, lastCheck: string|null,
//   franUrl: string, cloudUrl: string, token: string }
```

**既定値**:
- `franUrl`: `https://fraine.tail204746.ts.net/api`（Tailscale :8445の既存Express）
- `cloudUrl`: ''（空。未設定時はクラウド経路を使わない）
- `token`: ''（空）
- `route`: 'offline'
- `manual`: false

**関数**:

| 関数 | 動作 |
|---|---|
| `getConnection()` | localStorage から現在の状態を読み取って返す |
| `saveConnection(state)` | localStorage に保存 |
| `async checkReachability()` | franUrl + '/healthz' にタイムアウト付きfetch（既定3秒）。到達→route='fran'、不到達かつcloudUrl設定済み→cloudUrl + '/healthz' にfetch→到達→route='cloud'、どちらも不到達→route='offline'。結果をlastCheckとともに保存しreturn |
| `switchRoute(target)` | manual=true にして route を target に固定 |
| `clearManual()` | manual=false にして checkReachability() を呼ぶ |
| `updateSettings(settings)` | franUrl/cloudUrl/token/timeoutMs を更新して保存 |

**タイムアウト**: localStorage `pv-connection-timeout`（既定3000ms）。AbortController + setTimeoutで実装。

**visibilitychange**: `document.addEventListener('visibilitychange', ...)` で `manual=false` の場合のみ `checkReachability()` を呼ぶ。

**起動時**: App.jsxのuseEffect内で `checkReachability()` を呼ぶ。

### 手順2: src/lib/api.js を改修

現行の `const BASE = '/api'` を削除し、connection.jsの状態に基づいてBASEを動的に決定する。

```javascript
import { getConnection } from './connection.js';

async function request(path, opts = {}) {
  const conn = getConnection();
  let base;
  if (conn.route === 'fran') {
    base = conn.franUrl;  // 'https://fraine.tail204746.ts.net/api'
  } else if (conn.route === 'cloud') {
    base = conn.cloudUrl; // 'https://<workers>/api/prompt-vault'
  } else {
    throw new Error('サーバーに接続できません');
  }

  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (conn.route === 'cloud' && conn.token) {
    headers['Authorization'] = `Bearer ${conn.token}`;
  }

  const res = await fetch(`${base}${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}
```

**重要**: `api` オブジェクトの全関数（49本）はそのまま残す。`request` 関数の中身だけを差し替える。フロントの呼び出しコードは一切変更しない。

### 手順3: src/components/Header.jsx を改修

⚙ボタンの左に接続状態インジケーターを追加する。

**配置**: `header-right` のflex内に、ランプクラスター → ⚙ の順。

**ランプクラスター**:
- 円: 10px、border-radius: 50%
- 緑（#22c55e + box-shadow: 0 0 4px rgba(34,197,94,0.5)）= fran
- 赤（#ef4444 + box-shadow同様）= cloud
- 灰（#9ca3af）= offline
- テキスト: 接続先名（Fran / Cloud / 未接続）+ 最終確認時刻（HH:MM形式・font-size: 9px）
- タップ: `onOpenSettings` を呼ぶ（同時にデバッグセクションを開く。App.jsxから `debugInitialOpen` propを渡す方法で）

**Header propsの追加**: `connectionState` を受け取る。App.jsxで `getConnection()` の結果をstateとして管理し渡す。

モックアップ（承認済み）: ai-family-ops docs/prompt-vault-cloud/mockups/header-lamp-connection-panel.html を参照。

### 手順4: src/screens/SettingsScreen.jsx のデバッグセクション拡張

既存の「▶ デバッグ」セクションを「▶ デバッグ・接続」にリネームし、内容を拡張する。

**接続経路ボックス**（デバッグセクションの先頭に追加）:
- 現在の接続先（Fran / Cloud / 未接続）とバッジ（全機能 / 縮退 / —）
- 接続先URL表示
- 最終到達確認日時

**操作ボタン（2列）**:
- 「🔄 再接続」: `checkReachability()` を呼び、結果をトーストで通知
- 「🔀 Cloudへ切替」/「🔀 Franへ切替」: `switchRoute()` を呼ぶ。手動固定中は「🔓 手動解除」ボタンを表示し、`clearManual()` を呼ぶ

**クラウド状態ボックス**（クラウド経路時のみ表示）:
- cloudUrl + '/healthz' の応答から取得した情報を表示
- クラウド未設定の場合は「クラウドURLが未設定です」と表示

**既存の疎通テストボタン**: そのまま維持。加えて:
- 「R2/DO疎通」ボタン: クラウド経路のhealthzにfetchして結果を表示（Worker未完成の間は失敗するが、それでよい）

**版情報の拡張**:
- 既存のバージョン表示に加え、クラウド経路のhealthzから取得したversionとデプロイSHAを表示（クラウド経路が繋がらない場合は「—」）

### 手順5: src/screens/SettingsScreen.jsx の設定項目追加

既存の設定セクション（生成パラメータ・ガード・台詞表示の後）に「接続設定」セクションを新設する。

**接続設定セクション**:
- フランURL: テキスト入力。既定値リセットボタン
- クラウドURL: テキスト入力。空欄OK
- 認証トークン: テキスト入力（type="password" でマスク）
- 到達確認タイムアウト: 数値入力（ms・既定3000）

**選定則セクション**（接続設定の後）:
- 日数: スライダー（7〜90日・既定30）
- お気に入りを含める: チェックボックス（既定ON）
- R2上限: 数値入力（MB・既定5120）

接続設定の変更は `updateSettings()` で即座に反映し、保存ボタンは不要（localStorageに直接書く）。生成パラメータの保存ボタンとは独立。

選定則の値は現時点ではlocalStorageに保存するだけ。同期エージェントが参照するのは後続便。

### 手順6: src/lib/crypto.js を新規作成

vault鍵の管理とAES-256-GCM暗号化・復号のユーティリティ。

```javascript
// localStorage 'pv-vault-key' に { id: 'vault:v1', raw: '<base64>' }
export function hasVaultKey() { ... }
export function getVaultKey() { ... }  // → CryptoKey
export function setVaultKey(base64Raw) { ... }
export function clearVaultKey() { ... }
export async function generateVaultKey() { ... }  // → { id, raw(base64) }
export async function encrypt(plainBuffer) { ... }  // → Uint8Array(key_id_len + iv + ciphertext)
export async function decrypt(encryptedBuffer) { ... }  // → ArrayBuffer
```

**暗号文フォーマット**: `[1バイト: key_id長][key_id(UTF-8)][12バイト: IV][残り: ciphertext+tag]`

この便ではcrypto.jsを作成するだけで、実際の画像復号表示は後続便（最小コア）で使用する。

### 手順7: 設定画面にvault鍵管理UIを追加

接続設定セクション内に:
- 鍵の状態表示（「設定済み（vault:v1）」/「未設定」）
- 「新規生成」ボタン: `generateVaultKey()` → 鍵IDとbase64をコピー可能な表示
- 「インポート」ボタン: base64文字列を貼り付けて `setVaultKey()`
- 「エクスポート」ボタン: 現在の鍵をbase64で表示（コピーボタン付き）
- 「削除」ボタン: confirm → `clearVaultKey()`

## 禁止事項

- server/ 配下の変更（M-4: Tailscale版は無改変。CORSはこの便の対象外）
- src/ 配下で上記手順に記載されていないファイルの変更
- package.json への依存追加
- フロントの見た目の変更（ヘッダーのランプと設定セクションの追加以外。既存UIの色・フォント・レイアウトは触らない）

## テスト

### PG自己完結分

1. `npm run dev` で起動し、ブラウザで動作確認
2. ランプの表示: フラン起動中（localhost:8789）→ 緑・「Fran」
3. 設定画面: 接続設定・選定則・vault鍵管理の各UIが表示・操作できる
4. 再接続ボタン: 押下で到達確認が走り、結果がランプに反映
5. connection.js: `checkReachability()` がfranUrl到達時にroute='fran'を返す
6. api.js: 既存の全画面（生成・アルバム・テンプレート）が従来どおり動作する（regression確認）
7. crypto.js: 鍵の生成・暗号化・復号のround tripが成功

### 実機系（発注者に依頼）

1. Pixel 10 standaloneで起動 → ランプが緑で表示される
2. 設定画面の接続パネルが表示される
3. 既存の生成・アルバム・テンプレートが従来どおり動作する

## 完了条件

1. src/lib/connection.js 新規作成・動作
2. src/lib/api.js のBASE動的切替が動作し、既存機能にregressionがない
3. src/lib/crypto.js 新規作成・鍵生成/暗号化/復号が動作
4. Header.jsx にランプが表示され、接続状態に応じて緑/灰が切り替わる（クラウド未設定の間は赤は出ない）
5. SettingsScreen.jsx に接続パネル・接続設定・選定則・vault鍵管理が追加されている
6. `npm run build` がエラーなし
7. コミット・push済み（mainブランチ・バージョンは v3.11.0）
8. _STATUS.md 更新

## 報告基準

報告は docs/reports/ に置く。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約
2. 完了条件の各項に対する充足状況
3. npm run build の結果
4. 未完了・未検証の項目があれば列挙
5. 発注者指示による仕様外修正があればその旨と内容
6. コミットSHA・push状況
7. Pixel 10実機でのスクリーンショット依頼事項
