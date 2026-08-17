# Prompt Vault 実装仕様書（M1: 基盤構築）

文書種別: 権威文書
作成日: 2026-08-17 ／ PM: クリーデ
承認済み要件定義: ai-family-ops docs/20260817_prompt-vault_requirements_v1.1.md（2026-08-17承認）
適用デザイン規格: ai-family-ops skills/dev/design-standard/design-standard.md v1.3

---

## 1. 概要

- 何を作るか: NovelAI画像生成・プロンプト合成・保管・閲覧を一気通貫で扱う個人用生成基盤のサーバー骨格・設定画面・デバッグ基盤
- なぜ作るか: 再利用可能アセット初期導入方針の適用第一号（要件定義裁定#14）。後続M2〜M7の土台を先行構築する
- 誰が使うか: ショウゴさん（Pixel 10からのtailnet経由アクセスが主）

### 1.1 リポジトリとバージョン

- リポジトリ: misfortunemate-png/prompt-vault-dev（発注者新設済み・main）
- package.json name: `prompt-vault`（アプリの名前。リポジトリ名のdev接尾辞は旧v1との共存のための暫定措置）
- 内部バージョン: 3.0.0から開始（要件定義裁定#3）
- 旧リポジトリ（prompt-vault / prompt-vault-v2）の処置はM7で行う（要件定義裁定#4）。M1では触れない

## 2. ファイル構成（M1完了時点）

```
prompt-vault-dev/
├── CLAUDE.md
├── _STATUS.md
├── package.json
├── vite.config.js
├── .env.example
├── .gitignore
├── server.js
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css
│   ├── tokens.css              ← docs/supplied/から配置
│   ├── components/
│   │   ├── Toast.jsx
│   │   ├── Header.jsx
│   │   └── Footer.jsx
│   ├── screens/
│   │   ├── MainView.jsx        （3タブの空画面・M2以降の受け皿）
│   │   └── SettingsScreen.jsx   （デバッグ内包）
│   └── lib/
│       ├── api.js              （サーバーAPIクライアント）
│       └── errors.js           （エラー分類・ログ）
├── public/
│   ├── manifest.json
│   ├── icon-192.png            （プレースホルダ）
│   └── icon-512.png            （プレースホルダ）
├── data/                       （.gitignore対象）
│   └── settings.json
├── logs/                       （.gitignore対象）
├── scripts/
│   └── inspect.mjs
└── docs/
    ├── （仕様書・指示書）
    └── supplied/
        └── tokens.css
```

## 3. 技術選定

| 技術 | 理由 |
|---|---|
| Node.js + Express | chat-pwaと同一スタック。サーバー完結型（要件定義裁定#1） |
| Vite + React | 要件定義裁定#2。design-standard v1.0の適用対象 |
| localStorage | 表示設定（テーマ・フォントサイズ等）のクライアント側永続化 |
| JSON（data/settings.json） | 生成既定値・ガード設定のサーバー側永続化。M1規模ではSQLite不要 |

### 3.1 データ格納方針（全M通し・PM設計判断）

| データ種別 | 格納先 | 導入M |
|---|---|---|
| 表示設定 | localStorage | M1 |
| 生成既定値・ガード | data/settings.json | M1 |
| カード・プリセット | data/cards.json, data/presets.json | M3 |
| 画像インデックス | data/index.db（SQLite） | M4 |
| 画像ファイル | VAULT_ROOT（.env指定・リポジトリ外） | M2 |

SQLiteはM4（ハッシュベース検索・大量レコード）で導入する。M1〜M3はJSONで十分。

## 4. 機能仕様

### §1 サーバー骨格

- server.js: Express、ポート8788（.env `PORT`、既定8788）
- ルーティング: すべて `/vault` プレフィックス配下（要件定義裁定#11）
- 開発モード（`NODE_ENV !== 'production'`）: Vite dev middleware を Express にマウント
- 本番モード: `dist/` の静的配信
- API名前空間: `/vault/api/`
- ヘルスチェック: `GET /vault/api/healthz` → `{ status: "ok", version: "3.0.0" }`

### §2 画面構成・フロント基盤・PWA

#### 画面構成

```
┌─────────────────────────────┐
│ Header: [タブ名]        [⚙] │  ← 左にアクティブタブ名、右上に設定アイコン
├─────────────────────────────┤
│                             │
│         メイン領域           │  ← 3タブの中身（M1はすべて空画面）
│                             │
├─────────────────────────────┤
│  [生成]  [アルバム]  [テンプレ] │  ← Footer: メインナビゲーション
└─────────────────────────────┘
```

- **Header**: 左にアクティブタブ名、右上に⚙アイコン。⚙タップで設定画面（フルスクリーンオーバーレイ）を開く
- **Footer**: 生成 / アルバム / テンプレート の3タブ。アクティブ状態を`--accent`で示す。高さ54px
- **設定画面**: フルスクリーンオーバーレイ。ヘッダーに「← 戻る」。デバッグを最下部に折りたたみで内包
- **メイン領域**: M1では3タブすべて「M2以降で実装します」の空画面

#### フロント基盤

- Vite設定: `base: '/vault/'`
- React: 画面遷移はuseState（React Routerは使わない）。タブ切替（generate / album / template）＋設定オーバーレイ（boolean）
- PWA:
  - manifest.json: `scope: "/vault/"`, `start_url: "/vault/"`, `display: "standalone"`
  - Service Worker: `/vault/sw.js`。基本キャッシュ戦略（Cache First for assets, Network First for API）
  - 登録: `navigator.serviceWorker.register('/vault/sw.js', { scope: '/vault/' })`
- **M1検証項目**: サブパスPWAのSW更新挙動をPixel 10で確認する（要件定義リスク#2）

### §3 配線

- tailscale serve: `tailscale serve --set-path /vault 127.0.0.1:8788`
- start-all.bat改訂（ASCII・CRLF厳守）:
  - chat-pwaの起動行の後にprompt-vault-devのサーバー起動を追加
  - serve設定行に `/vault` パスを追加
- ポート衝突確認: PGがM1着工時に8788の使用状況を機械確認する（要件定義裁定#12）

### §4 設定画面

フルスクリーンオーバーレイ。ヘッダーに「← 戻る」。5セクション＋保存ボタン＋デバッグ折りたたみ。

#### §4.1 表示設定（クライアント側・localStorage）

design-standard §7に準拠。三層解決のうちglobal＋DEFAULTSの二層（local層なし）。

| 項目 | UI形 | 範囲 | 既定 |
|---|---|---|---|
| テーマ | ボタン群（light / dark / sepia） | 登録簿から動的生成 | light |
| 本文サイズ | スライダー | 14〜28px・1px刻み | 16px |
| 行間 | スライダー | 1.4〜2.4・0.1刻み | 1.7 |
| 余白 | スライダー | 0.5〜3.0rem・0.25刻み | 1.5rem |
| 和文フォント | セレクタ | 登録簿 | BIZ UDPGothic |
| 欧文フォント | セレクタ | 登録簿 | system-ui |

テーマ反映は`data-theme`属性の切替。その他は`style.setProperty`でCSS変数を直接書き換え。
本文サイズ変更時は4段階比率追従（heading=1.375, title=1.125, body=1.0, label=0.8125）。

フォント登録簿（M1初期値）:

| 軸 | id | label | family | source |
|---|---|---|---|---|
| 和文 | bizudp | BIZ UDPGothic | "BIZ UDPGothic", sans-serif | system |
| 和文 | noto-serif-jp | Noto Serif JP | "Noto Serif JP", serif | google |
| 和文 | noto-sans-jp | Noto Sans JP | "Noto Sans JP", sans-serif | google |
| 欧文 | system | System UI | system-ui, sans-serif | system |
| 欧文 | inter | Inter | "Inter", sans-serif | google |
| 欧文 | eb-garamond | EB Garamond | "EB Garamond", serif | google |

Googleフォントは選択中のもののみ`<link>`注入、未選択は除去。

#### §4.2 生成の既定値（サーバー側・data/settings.json）

| 項目 | UI形 | 既定 | 備考 |
|---|---|---|---|
| model | テキスト入力 | nai-diffusion-4-curated-preview | NAIモデル名 |
| 既定の幅 | 数値入力 | 832 | MP計算表示つき |
| 既定の高さ | 数値入力 | 1216 | MP計算表示つき |
| steps | スライダー | 28 | 1〜50。29以上でAnlas警告 |
| sampler | セレクタ | k_euler | k_euler / k_euler_ancestral / k_dpmpp_2m_sde（初期3種） |
| scale | スライダー | 5.0 | 1.0〜10.0・0.5刻み |
| seed | 数値入力 | -1（ランダム） | -1=ランダム、0以上=固定 |

幅×高さの下に `832×1216 = 1.01MP（無料枠内）` のような計算結果を表示。
Anlas警告の判定: `width * height > 1_048_576 || steps > 28` のときセクション上部に黄色の注意文を表示。

**解像度プリセット（832×1216 / 1024×1024 / 1216×832）はM2の生成画面に配置する。設定画面には含めない。**

#### §4.3 ガード設定（サーバー側・data/settings.json）

| 項目 | UI形 | 既定 | 制約 |
|---|---|---|---|
| 最小間隔（秒） | 数値入力 | 2 | ≥1 |
| 最大間隔（秒） | 数値入力 | 5 | ≥最小間隔 |
| ジョブ上限（枚） | 数値入力 | 100 | 1〜500 |

#### §4.4 システム情報（読み取り専用）

- VAULT_ROOT: .envの値をそのまま表示。未設定時は案内文
- APIキー状態: 設定済み（先頭4文字＋****）/ 未設定

#### §4.5 保存ボタン

設定画面下部に配置。生成既定値・ガードの変更を `PUT /vault/api/settings` で一括保存。表示設定はlocalStorageに即時反映（保存ボタン不要）。

#### §4.6 デバッグ（折りたたみ・設定画面最下部）

保存ボタンの下に「▶ デバッグ」折りたたみセクションを配置。展開すると以下を表示。

| 機能 | 動作 |
|---|---|
| バージョン表示 | package.jsonのversionを表示 |
| SWキャッシュクリア＋リロード | SWにメッセージ送信→caches.delete→location.reload |
| 全データリセット | confirm×2→localStorage全消去＋サーバー側data/リセット→リロード |
| NovelAI疎通テスト | `POST /vault/api/debug/test-api`→APIキーの有効性確認 |
| FS書込テスト | `POST /vault/api/debug/test-fs`→VAULT_ROOTへの書込・読取・削除テスト |
| 直近エラー一覧 | `GET /vault/api/debug/errors`→ログファイルから直近20件を表示 |

### §5 エラーハンドリング基盤

#### §5.1 エラー分類

| 種別 | 接頭辞 | 例 |
|---|---|---|
| API | `API_` | API_AUTH_FAILED, API_RATE_LIMITED, API_NETWORK |
| FS | `FS_` | FS_WRITE_FAILED, FS_NOT_FOUND, FS_PERMISSION |
| VALIDATION | `VAL_` | VAL_INVALID_PARAM, VAL_MISSING_FIELD |

#### §5.2 トースト通知

- 位置: 画面下部（Footerの上）
- type: success（`--accent`地）/ error（赤系）/ info（`--text-secondary`）
- 自動消去: 3秒。errorは手動消去のみ
- 複数同時表示: 最大3件、古いものから消去

#### §5.3 サーバー側ログ

- ファイル: `logs/YYYY-MM-DD.log`（JSONL形式）
- 1行の形式: `{ "ts": "ISO8601", "level": "error|warn|info", "code": "API_AUTH_FAILED", "message": "...", "detail": "..." }`
- ローテーション: 日単位で自動分割。古いログの削除はM1では行わない

### §6 API一覧（M1）

| メソッド | パス | 用途 |
|---|---|---|
| GET | /vault/api/healthz | ヘルスチェック |
| GET | /vault/api/settings | 全設定取得（server側） |
| PUT | /vault/api/settings | 設定更新（server側） |
| GET | /vault/api/system-info | VAULT_ROOT・APIキー状態 |
| POST | /vault/api/debug/test-api | NovelAI疎通テスト |
| POST | /vault/api/debug/test-fs | FS書込テスト |
| GET | /vault/api/debug/errors | 直近エラー一覧 |
| POST | /vault/api/debug/reset | 全データリセット |

### §7 全体アーキテクチャ方針（後続Mへの申し送り）

以下はM1で実装しないが、M1の設計がこれらと矛盾しないことを確認済み。

- **解像度プリセット**: M2の生成画面にボタン群として配置（832×1216 / 1024×1024 / 1216×832）。生成時に頻繁に切り替える操作なのでグローバル設定ではなく生成UIに置く
- **生成バックエンド抽象化**: M2でNovelAI実装時にアダプタ層を設ける
- **サムネイルキャッシュ**: M4でsharpによるバックグラウンド生成を導入
- **SQLiteインデックス**: M4でbetter-sqlite3を導入
- **ジョブキュー**: M5でサーバー側キュー実装

## 5. テスト方針

| テスト対象 | 方法 | 合格条件 |
|---|---|---|
| サーバー起動 | `node server.js` → healthz | JSON応答・version一致 |
| 画面構成 | ブラウザでlocalhost:8788/vault/ | Header(タブ名+⚙)+Footer(3タブ)+空画面 |
| 設定開閉 | ⚙タップ→設定表示→戻るで閉じる | フルスクリーンオーバーレイの開閉 |
| 表示設定の永続化 | テーマ変更→設定閉じる→リロード | 設定が保持される |
| 生成既定値の保存 | 値変更→保存→APIで確認 | data/settings.jsonに反映 |
| デバッグ折りたたみ | ▶デバッグ展開→各機能 | バージョン表示・SW消去・リセット動作 |
| トースト | 保存成功・エラー発生 | type別色分け・自動消去 |
| PWA（実機） | Pixel 10でstandalone起動 | ホーム画面追加・起動・SW登録 |
| tailscale serve | /vault でアクセス | Pixel 10からhttps://fraine.tail204746.ts.net/vault/ |
| ポート衝突 | 8788で起動 | chat-pwa（8787）と共存 |

実機系テスト（発注者に依頼）: PWA standaloneのSW更新挙動（Pixel 10）、tailscale経由のモバイル表示確認

## 改訂履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-08-17 | v1.0 | 初版（M1: 基盤構築） |
| 2026-08-17 | v1.1 | 画面構成改訂: Header+Footer方式、設定フルスクリーン化、デバッグを設定内包、解像度プリセットをM2生成画面に移動 |
