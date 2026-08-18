# Prompt Vault 作業指示書（M1: NW改修・ベースパス撤去）

文書種別: 権威文書
作成日: 2026-08-18 ／ PM: クリーデ ／ 対応仕様: docs/20260817_prompt-vault_spec_m1.md v1.3 ／ 本書一枚で完結（追補なし）

## 背景

M1の配線（§3）が「443パス同居＋/vault/ベースパス」で設計されていたが、tailscale serveの`--set-path`がパスを剥がす仕様と噛み合わず配線に失敗した。発注者裁定（2026-08-18）により、専用ポート8445（tailnet専用serve）＋ベースパス撤去（ルート`/`）に変更する。NW台帳（ai-family-memory ops/state/network.yaml）にポート8445を予約登記済み。

## 添付マニフェスト（着工前照合・必須）

以下がすべて交換所（リポジトリ）に存在すること。**1つでも欠けたら着工せず docs/reports/ に報告。**

| # | パス | 種別 | SHA-256（支給物のみ） |
|---|---|---|---|
| 1 | docs/20260817_prompt-vault_spec_m1.md | 仕様書（v1.3） | — |
| 2 | docs/supplied/tokens.css | デザイン規格トークン | 4850377ad7e24581657e3117ed64e08b666f183ea05ede51240a13517db2eb07 |

## PG運用規律（定型・全フェーズ共通）

1. **三則**: ①難航時はPMへ差し戻す ②原因判明時は「原因X・対策Y・実行可否」で報告→指示待ち ③セッション外プロセス停止等は事前許可
2. **宛先**:
   - **仕様の疑義・技術判断** → docs/reports/ にpushしてPMへ
   - **環境・インフラの問題**（ファイルが見つからない、権限、起動不能等）→ 発注者に直接聞いてよい
   - **実機試験の依頼・承認** → 発注者
3. **支給物改変禁止**: docs/supplied/tokens.css はdiffゼロで検収される
4. **発注者指示による仕様外修正**: 発注者から直接指示を受けた修正は実施・効果確認してよい。報告時に「発注者の指示により実装/修正」と明記する。権威文書は書き換えない
5. **着工前**: `git pull` → inspect実行（マニフェスト照合・版確認）。緑でなければ着工しない
6. **完了宣言禁止**: inspect緑を添えて「確認をお願いします」で止める

## 作業範囲

- 何を: M1実装済みコードから`/vault/`ベースパスを除去し、配線を専用ポート8445に変更する
- なぜ: NW-2解決（443パス同居の失敗→専用ポート方式への移行）、仕様v1.3適合
- どこで: misfortunemate-png/prompt-vault-dev（D:\AI\github\prompt-vault-dev）

## 作業手順

### 手順0: 工程0（NW配線ガイドラインv1.0 §3）

着工前に以下を実行し、現状を報告に記録する。

1. `netstat -ano | findstr 8789` — ローカルポート8789の使用状況
2. `netstat -ano | findstr 8445` — tailscaleポート8445の使用状況（空きであること）
3. `tailscale serve status` — 現在のserve設定全体（`/vault`残骸の有無を確認）

`/vault`のserve設定が残っている場合は `tailscale serve --remove /vault` で除去してから進む。443ポートのchat-pwa設定（`http://127.0.0.1:8787`）が欠落している場合は、発注者に報告して指示を仰ぐ。

### 手順1: コード改修（6ファイル）

以下の全ファイルから`/vault/`ベースパスを除去する。

**vite.config.js**:
- `base: '/vault/'` → `base: '/'`

**server.js**:
- `app.use('/vault/api', api)` → `app.use('/api', api)`
- `/vault/sw.js`ルート → `/sw.js`
- `/vault/manifest.json`ルート → `/manifest.json`
- `/vault/icon-192.png`ルート → `/icon-192.png`
- `/vault/icon-512.png`ルート → `/icon-512.png`
- `Service-Worker-Allowed`ヘッダー: `'/vault/'` → `'/'`
- 本番モード: `app.use('/vault', express.static(...))` → `app.use(express.static(...))`
- コンソールログ: `http://localhost:${PORT}/vault/` → `http://localhost:${PORT}/`

**public/manifest.json**:
- `"start_url": "/vault/"` → `"start_url": "/"`
- `"scope": "/vault/"` → `"scope": "/"`
- アイコンsrc: `"/vault/icon-192.png"` → `"/icon-192.png"`、`"/vault/icon-512.png"` → `"/icon-512.png"`

**src/main.jsx**:
- SW登録: `register('/vault/sw.js', { scope: '/vault/' })` → `register('/sw.js', { scope: '/' })`

**src/lib/api.js**:
- `const BASE = '/vault/api'` → `const BASE = '/api'`

**public/sw.js**:
- `url.pathname.startsWith('/vault/api/')` → `url.pathname.startsWith('/api/')`
- `url.pathname.startsWith('/vault/assets/')` → `url.pathname.startsWith('/assets/')`

**index.html**:
- `href="/vault/manifest.json"` → `href="/manifest.json"`

### 手順2: CLAUDE.md更新

以下を反映する。
- 「base URL は `/vault/` を前提とすること」 → 「base URL はルート `/` 。ベースパスなし」
- 「配信: tailscale serve --set-path /vault」 → 「配信: tailscale serve --https=8445（tailnet専用）」
- 権威文書リストに本指示書を追加

### 手順3: start-all.bat改訂

D:\AI\start-all.batを改訂する（**ASCII・CRLF厳守**）。

1. 現在のbat内容を読み取り、報告に記録する
2. 以下を変更:
   - `/vault`パスの`tailscale serve --set-path`行が残っていれば**削除**
   - prompt-vault-devサーバー起動行が未追加なら追加（chat-pwaの起動行の後）: `start "" /B cmd /c "cd /d D:\AI\github\prompt-vault-dev && node server.js"`（既存行の書式に合わせる）
   - serve設定に追加: `tailscale serve --bg --https=8445 http://127.0.0.1:8789`
3. 改訂後のbatが**ASCII・CRLFであることを検証**する（`file`コマンドまたはPowerShellの`Get-Content -Encoding Byte`等）

### 手順4: 動作確認

1. prompt-vaultサーバーを再起動（`node server.js`）
2. `curl http://localhost:8789/api/healthz` — JSON応答・version一致
3. ブラウザで `http://localhost:8789/` — Header＋Footer＋空画面が表示
4. 設定画面の開閉
5. `tailscale serve --bg --https=8445 http://127.0.0.1:8789` を実行
6. `tailscale serve status` — 8445行が追加されていること、443のchat-pwa設定が無傷であること

### 手順5: _STATUS.md・inspect・コミット

1. _STATUS.mdを更新（status: done維持、NW改修完了の記録を追加）
2. `npm run inspect` — ALL GREEN
3. 5W1Hコミット・push

## 禁止事項

- 443ポートのchat-pwa serve/funnel設定への変更（触れない）
- 8443・10000ポート（rag-system所有）への変更
- `/vault/`プレフィックスの残留（改修漏れ）
- start-all.batへの日本語記述（ASCII厳守）
- docs/supplied/tokens.css の内容変更

## テスト

- PG自己完結分:
  - `curl http://localhost:8789/api/healthz` → version: "3.0.0"
  - ブラウザで `http://localhost:8789/` → 画面表示（ベースパスなし）
  - 設定画面の開閉・テーマ変更・保存→リロード後の保持
  - `tailscale serve status` で8445行の存在と443行の無傷を確認
  - `npm run build` → 警告なし
  - inspect ALL GREEN
  - start-all.bat ASCII・CRLF検証
  - ソースコード全体で `/vault/` が残っていないことをgrep確認: `grep -r "/vault/" src/ public/ server.js vite.config.js index.html`（0件であること。docs/は除外）
- **実機系（発注者に依頼）**:
  - Pixel 10で `https://fraine.tail204746.ts.net:8445/` にアクセス
  - PWA: ホーム画面に追加 → standalone起動
  - 旧PWA（/vault/で登録済みの場合）の削除

## 完了条件

- 全ソースから`/vault/`ベースパスが除去されていること（grep 0件）
- `http://localhost:8789/` でM1の全画面が表示されること
- tailscale serve 8445が設定済み、443のchat-pwaが無傷
- start-all.bat改訂済み・ASCII・CRLF
- inspect ALL GREEN・_STATUS.md更新・5W1Hコミット
