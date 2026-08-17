# Prompt Vault 作業指示書（M1: 基盤構築）

文書種別: 権威文書
作成日: 2026-08-17 ／ PM: クリーデ ／ 対応仕様: docs/20260817_prompt-vault_spec_m1.md v1.2 ／ 本書一枚で完結（追補なし）

## 添付マニフェスト（着工前照合・必須）

以下がすべて交換所（リポジトリ）に存在すること。**1つでも欠けたら着工せず docs/reports/ に報告。**

| # | パス | 種別 | SHA-256（支給物のみ） |
|---|---|---|---|
| 1 | docs/20260817_prompt-vault_spec_m1.md | 仕様書 | — |
| 2 | docs/supplied/tokens.css | デザイン規格トークン | 4850377ad7e24581657e3117ed64e08b666f183ea05ede51240a13517db2eb07 |

## PG運用規律（定型・全フェーズ共通）

1. **三則**: ①難航時はPMへ差し戻す ②原因判明時は「原因X・対策Y・実行可否」で報告→指示待ち ③セッション外プロセス停止等は事前許可
2. **宛先**:
   - **仕様の疑義・技術判断** → docs/reports/ にpushしてPMへ
   - **環境・インフラの問題**（ファイルが見つからない、権限、起動不能等）→ 発注者に直接聞いてよい
   - **実機試験の依頼・承認** → 発注者
3. **支給物改変禁止**: docs/supplied/tokens.css はdiffゼロで検収される。src/tokens.css として配置時にも内容を変更しない
4. **発注者指示による仕様外修正**: 発注者から直接指示を受けた修正は実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記する。権威文書は書き換えない
5. **着工前**: `git pull` → inspect実行（マニフェスト照合・版確認）。緑でなければ着工しない
6. **完了宣言禁止**: inspect緑を添えて「確認をお願いします」で止める

## 作業範囲

- 何を: リポジトリ初期セットアップ、サーバー骨格、PWA基盤、設定画面（デバッグ内包）、エラーハンドリング基盤、tailscale serve配線、inspect
- なぜ: 要件定義裁定#14（再利用可能アセット初期導入）、M2以降の土台
- どこで: misfortunemate-png/prompt-vault-dev（D:\AI\github\prompt-vault-dev）

## 作業手順

### 手順1: ポート衝突確認

8789番ポートの使用状況を確認する。`netstat -an | findstr 8789` または同等の方法で衝突がないことを確認。衝突がある場合のみ docs/reports/ に報告し代替ポートを提案する。

### 手順2: リポジトリ初期セットアップ

- `npm init` → package.json（name: `prompt-vault`, version: `3.0.0`）
- 依存パッケージのインストール:
  - 本番: express
  - 開発: vite, @vitejs/plugin-react, react, react-dom
- vite.config.js: `base: '/vault/'`、React plugin、server.hmr設定（Express統合用）
- .env.example:
  ```
  PORT=8789
  NOVELAI_API_KEY=
  VAULT_ROOT=
  ```
- .gitignore: node_modules, dist, data/, logs/, .env
- docs/supplied/tokens.css → src/tokens.css にコピー（内容不変）
- CLAUDE.md: テンプレートに従い作成。文書階層に発注文書（ai-family-ops docs/20260817_prompt-vault_requirements_v1.1.md）、権威文書（docs/内）を記載。規約に「base URL /vault/ を前提とすること」「ポート8789」を含める
- _STATUS.md: テンプレートに従い作成

### 手順3: サーバー骨格（仕様§1）

server.js を作成。

- Express、PORT は process.env.PORT || 8789
- 開発モード（NODE_ENV !== 'production'）: Vite createServer → middlewares を Express にマウント
- 本番モード: `express.static('dist')` を `/vault` にマウント
- API名前空間 `/vault/api/` のルーター
- `GET /vault/api/healthz` → `{ status: "ok", version: "3.0.0" }`（package.json から読み取り）
- `GET /vault/api/settings` → data/settings.json を返す。ファイル未存在時は既定値で初期化
- `PUT /vault/api/settings` → リクエストボディで data/settings.json を上書き
- `GET /vault/api/system-info` → VAULT_ROOT のパスと存在確認、APIキーの設定有無（マスク値: 先頭4文字＋"****"）
- data/ ディレクトリの自動作成（起動時に mkdirSync recursive）
- data/settings.json の既定値:
  ```json
  {
    "generation": {
      "model": "nai-diffusion-4-curated-preview",
      "width": 832,
      "height": 1216,
      "steps": 28,
      "sampler": "k_euler",
      "scale": 5.0,
      "seed": -1
    },
    "guard": {
      "intervalMin": 2,
      "intervalMax": 5,
      "maxPerJob": 100
    }
  }
  ```

### 手順4: エラーハンドリング基盤（仕様§5）

サーバー側:
- logs/ ディレクトリの自動作成
- ログ関数: `logs/YYYY-MM-DD.log` にJSONL形式で追記（ts, level, code, message, detail）
- `GET /vault/api/debug/errors` → 当日ログファイルから直近20件を返す（ファイル未存在時は空配列）
- Express のエラーハンドリングミドルウェア: 未捕捉エラーをログに記録しJSON応答

フロント側:
- src/lib/errors.js: エラー分類（API_ / FS_ / VAL_）の定数とエラー生成ヘルパー
- src/components/Toast.jsx: success / error / info のtype色分け（仕様§5.2）。Footer上に表示、最大3件、success/info は3秒後自動消去、error は手動消去
- Toast状態管理: App.jsx でuseStateで管理し、addToast/removeToast をコンテキストまたはprops経由で各画面に渡す

### 手順5: フロント骨格（仕様§2）

- src/main.jsx: React root の作成、SW登録
- src/App.jsx: 画面状態管理（タブ: 'generate' | 'album' | 'template' のuseState ＋ 設定オーバーレイ: boolean のuseState）、Toast状態
- src/index.css: tokens.css を @import、html/body の基本スタイル（background: var(--bg), color: var(--text), font-family: var(--font-body)）
- src/components/Header.jsx: 左にアクティブタブ名、右上に⚙アイコンボタン。⚙タップで設定オーバーレイをopen。position: sticky, top: 0, 高さ48px
- src/components/Footer.jsx: 画面下部固定。生成 / アルバム / テンプレート の3タブ。アクティブ状態を --accent で表示。高さ54px、各タブmin-height 44px
- src/screens/MainView.jsx: 3タブの空画面。「M2以降で実装します」の一文

### 手順6: 設定画面（仕様§4）

src/screens/SettingsScreen.jsx を作成。フルスクリーンオーバーレイ（position: fixed, inset: 0, z-index: 1000）。

ヘッダー: 左に「← 戻る」（onCloseコールバック）、中央に「設定」。

**§4.1 表示設定セクション**:
- テーマ切替: light / dark / sepia のボタン群。選択中を塗り（primary）、非選択をアウトライン（secondary）
- 本文サイズスライダー: 14〜28px、現在値表示。変更時に4段階比率追従（heading=×1.375, title=×1.125, label=×0.8125）を `style.setProperty` で反映
- 行間スライダー: 1.4〜2.4
- 余白スライダー: 0.5〜3.0rem
- 和文フォントセレクタ: 登録簿から生成。変更時にGoogleフォントの`<link>`注入/除去
- 欧文フォントセレクタ: 同上
- 保存先: localStorage（キー `pv-display-settings`）。変更は即時反映・即時保存
- 起動時の復元: App.jsx のマウント時にlocalStorageから読み取り適用

**§4.2 生成の既定値セクション**:
- model: テキスト入力
- 既定の幅・既定の高さ: 数値入力（横並び）。下に `832×1216 = 1.01MP（無料枠内）` のような計算表示
- Anlas警告: `width * height > 1_048_576 || steps > 28` のときセクション上部に黄色背景の注意文「無料枠を超えています。Anlasが消費されます」を表示
- **解像度プリセットボタンは設定画面に含めない**（M2の生成画面で実装）
- steps: スライダー 1〜50
- sampler: セレクタ（k_euler / k_euler_ancestral / k_dpmpp_2m_sde）
- scale: スライダー 1.0〜10.0、0.5刻み
- seed: 数値入力。-1でランダム

**§4.3 ガード設定セクション**:
- 最小間隔・最大間隔・ジョブ上限の数値入力
- バリデーション: 最大間隔 ≥ 最小間隔、最小間隔 ≥ 1、ジョブ上限 1〜500

**§4.4 システム情報セクション**（読み取り専用）:
- VAULT_ROOT: パス表示。未設定時は「未設定（.envにVAULT_ROOTを設定してください）」
- APIキー状態: 設定済み（先頭4文字＋****）/ 未設定

**§4.5 保存ボタン**:
- 画面下部に配置。`PUT /vault/api/settings` で生成既定値＋ガードを一括保存→成功トースト

**§4.6 デバッグ（折りたたみ）**:
- 保存ボタンの下に「▶ デバッグ」折りたたみトグル。既定は閉じた状態
- 展開時の内容:
  - バージョン表示: healthz から取得
  - SWキャッシュクリア＋リロードボタン: SW にメッセージ送信（CLEAR_CACHE）→caches.keys()で全削除→location.reload()
  - 全データリセットボタン: confirm「設定とデータをすべて削除しますか？」→confirm「本当に削除しますか？元に戻せません」→`POST /vault/api/debug/reset`＋localStorage全消去→リロード
  - NovelAI疎通テストボタン: `POST /vault/api/debug/test-api`→結果をトースト
  - FS書込テストボタン: `POST /vault/api/debug/test-fs`→結果をトースト
  - 直近エラー一覧: `GET /vault/api/debug/errors` から取得。各エントリをカード表示。空なら「エラーはありません」

### 手順7: PWA（仕様§2）

- public/manifest.json:
  ```json
  {
    "name": "Prompt Vault",
    "short_name": "Vault",
    "start_url": "/vault/",
    "scope": "/vault/",
    "display": "standalone",
    "background_color": "#faf8f5",
    "theme_color": "#8b4513",
    "icons": [
      { "src": "/vault/icon-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/vault/icon-512.png", "sizes": "512x512", "type": "image/png" }
    ]
  }
  ```
- public/sw.js: Cache First for static assets（/vault/assets/）、Network First for API（/vault/api/）。CLEAR_CACHE メッセージハンドラ。キャッシュ名に version を含める（`prompt-vault-v3.0.0`）
- public/icon-192.png, icon-512.png: 単色プレースホルダ（最低限PWA要件を満たすもの）
- main.jsx でSW登録

### 手順8: tailscale serve配線（仕様§3）

- D:\AI\start-all.bat を改訂（**ASCII・CRLF厳守**）
- 追加内容:
  1. prompt-vault-devサーバー起動行（chat-pwaの起動行の後）
  2. serve設定に `/vault` パスの追加: `tailscale serve --set-path /vault 127.0.0.1:8789`
- 改訂後のbatがASCII・CRLFであることを検証手段で確認

### 手順9: inspect.mjs

scripts/inspect.mjs を作成。npm scripts に `"inspect": "node scripts/inspect.mjs"` を追加。

検査項目:
1. マニフェスト照合: docs/instructions/ の指示書に記載された参照文書が存在するか
2. 支給物SHA-256照合: docs/supplied/tokens.css のハッシュ一致
3. 版確認: package.json の version と healthz 応答の version が一致（サーバー未起動時はpackage.jsonのみ表示してスキップ）
4. _STATUS.md 行数チェック: 30行以内
5. ビルド確認: `npm run build` が警告なしで完了
6. 禁止パターン: （M1では対象なし。M2以降で追加）

出力: 各項目に ✅ / ❌ を付け、全項目 ✅ なら `=== ALL GREEN ===` を表示

## 禁止事項

- docs/supplied/tokens.css の内容変更
- NOVELAI_API_KEY を .env.example やソースコードにハードコード
- React Router の導入（useState で画面切替）
- start-all.bat に日本語を含めること（ASCII厳守）
- 解像度プリセットボタンの設定画面への配置（M2の生成画面で実装する）
- M2以降の機能（生成実行、カードCRUD等）の先行実装

## テスト

- PG自己完結分:
  - `node server.js` → `curl localhost:8789/vault/api/healthz` で version: "3.0.0" 応答
  - ブラウザで localhost:8789/vault/ → Header(タブ名+⚙)+Footer(3タブ)+空画面
  - ⚙タップ→設定画面表示→戻るで閉じる
  - テーマ変更 → 設定閉じる → リロード → 設定保持
  - 生成既定値変更 → 保存 → data/settings.json に反映確認
  - デバッグ折りたたみ展開→バージョン表示・SW消去・エラー一覧
  - FS書込テスト（VAULT_ROOT設定時のみ）
  - `npm run build` → dist/ 生成・警告なし
  - inspect 緑
  - start-all.bat の ASCII・CRLF 検証
- **実機系（発注者に依頼）**:
  - Pixel 10 で https://fraine.tail204746.ts.net/vault/ にアクセス
  - PWA: ホーム画面に追加 → standalone 起動
  - SW更新挙動: サブパス `/vault/` でのSW登録・キャッシュ・更新
  - NovelAI疎通テスト（APIキー設定後）

## 完了条件

- 仕様§1〜§5の全機能が実装され、上記PGテストがすべて合格
- tokens.css が支給物と diff ゼロ（inspect SHA-256照合で確認）
- start-all.bat 改訂済み・ASCII・CRLF
- scripts/inspect.mjs 実装済み・ALL GREEN
- サーバー再起動・pull・push 実施済み
- _STATUS.md 更新（フロントマター含む）
- 5W1H コミット
