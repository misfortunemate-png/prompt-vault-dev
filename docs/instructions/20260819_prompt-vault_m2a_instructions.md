# Prompt Vault 作業指示書（M2-A: サーバーAPI＋生成画面）

文書種別: 権威文書
作成日: 2026-08-19 ／ PM: クリーデ ／ 対応仕様: docs/20260819_prompt-vault_spec_m2.md v1.1 ／ 本書一枚で完結

## 背景

M1（サーバー骨格＋配線＋設定画面）の上にM2を構築する。M2-Aではサーバー側API（プリセット・生成・保存・画像配信）と生成画面を実装する。アルバム画面はM2-Bで別途指示。

## 添付マニフェスト（着工前照合・必須）

| # | パス | 種別 | SHA-256（支給物のみ） |
|---|---|---|---|
| 1 | docs/20260819_prompt-vault_spec_m2.md | 仕様書（v1.1） | — |
| 2 | docs/supplied/tokens.css | デザイン規格トークン | 4850377ad7e24581657e3117ed64e08b666f183ea05ede51240a13517db2eb07 |

**参照物（コピー元・改変可）**:
- `D:\AI\github\chat-pwa\server\providers\imagegen\novelai.js` — ZIPパーサーの参照実装（SHA-256: b2eb0c6dd03189fd529f5c3391cdbaa06871935c6ac4ccfd0a2caa1b62fe187f）。ZIP手動展開部分を移植する。API呼び出し部分はV4.5構造に書き換えること

## PG運用規律（定型・全フェーズ共通）

1. **三則**: ①難航時はPMへ差し戻す ②原因判明時は「原因X・対策Y・実行可否」で報告→指示待ち ③セッション外プロセス停止等は事前許可
2. **宛先**: 仕様疑義→docs/reports/、環境・インフラ→発注者に直接、実機試験→発注者
3. **支給物改変禁止**: docs/supplied/tokens.css はdiffゼロで検収
4. **発注者指示による仕様外修正**: 実施してよい。報告に「発注者の指示」と明記
5. **着工前**: `git pull` → inspect ALL GREEN。緑でなければ着工しない
6. **完了宣言禁止**: inspect緑を添えて「確認をお願いします」で止める

## 作業範囲

- 何を: NovelAI API V4.5対応の生成機能＋保存機能＋生成画面UIの実装
- なぜ: M2「単発生成→保存」の基本フロー確立
- バージョン: package.json `3.1.0` に更新

## 作業手順

### 手順1: サーバー側 — プリセット管理

- `GET /api/presets` — `VAULT_ROOT/presets.json` を読み出して返す
- サーバー起動時に `VAULT_ROOT/presets.json` が存在しなければ初期データで生成する
- 初期データの構造は仕様書 §2.2 に従う。プリセット3件・キャラ3件・シチュ4件・衣装4件・その他4件程度
- VAULT_ROOT未設定時は起動は成功させるが、生成・保存・画像系APIはすべて400で「VAULT_ROOT未設定」を返す

### 手順2: サーバー側 — NovelAI APIアダプター

`server/providers/novelai.js` を新設。

- chat-pwaの `novelai.js` からZIPパーサー（`inflateRaw` + PK\x03\x04ヘッダー走査 + bit3データデスクリプタ対応）を移植する
- API呼び出しはV4.5構造に書き換える。仕様書 §3.2 のV4リクエスト構造を使用
- モデル文字列が `nai-diffusion-3` のときのみV3形式にフォールバック（§3.2参照）
- 認証: `Authorization: Bearer {NOVELAI_TOKEN}`（.env）
- seed未指定時は `crypto.randomInt(0, 2**32)` で生成
- ZIPからPNGを取り出し、`VAULT_ROOT/.tmp/{timestamp}_{hex}.png` に保存
- 戻り値: ファイル名・seed・幅・高さ

### 手順3: サーバー側 — 生成・保存・画像配信API

`POST /api/generate`:
- リクエストボディからプロンプト・パラメータを受け取り、NovelAIアダプターを呼ぶ
- 成功時: `{ success: true, image: { filename, seed, width, height } }`
- 無料枠チェックはクライアント側で行う（サーバーは検証しない）

`POST /api/save`:
- `{ filename, character, outfit }` を受け取る
- `.tmp/{filename}` → `{character}/{outfit}_{YYYYMMDD}_{HHmmss}_{hex}.png` にリネーム移動
- キャラが「（なし）」の場合のフォルダ名は `その他`
- 第二プリセット（outfit）が「（なし）」の場合は `gen` をプレフィックスにする
- フォルダが存在しなければ作成（`fs.mkdirSync recursive`）

`GET /api/images`:
- VAULT_ROOT直下のフォルダ一覧（名前・件数）＋ 新着（全フォルダから更新日時降順で直近8件）

`GET /api/images/:folder`:
- フォルダ内のPNG一覧（名前順）

`GET /api/images/:folder/:filename` / `GET /api/images/.tmp/:filename`:
- 画像本体（Content-Type: image/png）
- パストラバーサル防止: ファイル名に `..` や `/` が含まれていれば400

### 手順4: クライアント側 — 生成画面

仕様書 §2 およびモックアップ（docs/supplied/に配置予定）に従い、フッター「生成」タブに以下を実装。

上から下へスクロール:
1. プリセット選択プルダウン（`/api/presets` から取得）
2. 個別プルダウン群（キャラ/シチュ/衣装/その他・先頭「（なし）」）
3. 「プロンプト確認・編集」折りたたみ（既定閉）: 結合結果＋ネガティブのテキストエリア
4. 「パラメータ」折りたたみ（既定閉）: 2列グリッド（モデル/解像度/ステップ/ガイダンス/サンプラー/シード）
5. 生成ボタン（スクロール内・固定フッターにしない）
6. 生成結果一覧（カード降順）

プロンプト結合: `{preset.positive}, {character}, {situation}, {outfit}, {extra}`。「（なし）」はスキップ。

生成結果カード:
- 72×72正方形サムネイル（`/api/images/.tmp/:filename`・ブラウザリサイズ）
- パラメータ（解像度・seed・キャラ/衣装）
- 保存ボタン → `/api/save` → 「✓ 保存済み」に変化

無料枠ガード:
- ステップ > 28: confirm() で「Anlas消費」警告
- 解像度: プリセット固定のため違反は起こらない

生成中:
- ボタンを「生成中…」に変更、disabled
- エラー時: トースト通知 + ボタン復帰

VAULT_ROOT未設定時:
- 生成ボタンを無効化
- 「設定画面でVAULT_ROOTを確認してください」のメッセージ表示

### 手順5: 設定画面拡張

M1の設定画面に追加:
- VAULT_ROOT表示（読み取り専用・`/api/system-info`に含める）
- NOVELAI_TOKEN状態表示（設定済み/未設定）
- 既定モデル選択（settings.jsonに保存・生成画面の初期値に使用）

### 手順6: CLAUDE.md・_STATUS.md・inspect

- CLAUDE.mdにM2-A関連の記述を追加（API一覧・VAULT_ROOTの扱い等）
- _STATUS.md更新
- package.json version: `3.1.0`
- `npm run inspect` — ALL GREEN
- 5W1Hコミット・push

## 禁止事項

- npm依存の追加（ZIPパーサーは手動実装・zlibは標準ライブラリ）
- VAULT_ROOT外へのファイル書き出し
- パストラバーサル（`..`や絶対パス）を許す画像配信
- docs/supplied/tokens.css の内容変更
- start-all.batへの変更（発注者管理）

## テスト

仕様書 §8 のPG自己完結テストのうち、以下がM2-Aの対象:

| 項目 | 合格基準 |
|---|---|
| プリセット読み込み | プルダウンに名前表示 |
| プロンプト結合 | 選択→編集展開で正しい結合 |
| V4.5生成 | 画像表示・.tmpに保存・v4_prompt構造あり |
| V3生成 | v4_prompt構造なし |
| 保存 | フォルダ移動・ファイル名規則準拠 |
| 名前順 | 同一フォルダに衣装違い→名前順でまとまる |
| 無料枠ガード | ステップ29で警告 |
| VAULT_ROOT未設定 | 生成ボタン無効 |
| build | 警告なし |
| inspect | ALL GREEN |
| `/vault/` 残留grep | src/ public/ server.js で0件（M1-NW確認の継続） |

## 完了条件

- `POST /api/generate` でNovelAI V4.5画像が生成できること
- 生成結果カードの保存ボタンでフォルダに振り分けられること
- `GET /api/images` でフォルダ一覧＋新着が返ること
- inspect ALL GREEN・_STATUS.md更新・5W1Hコミット
