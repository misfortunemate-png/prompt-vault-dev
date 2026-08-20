# Prompt Vault M4-A 作業指示書
文書種別: 権威文書

作成日: 2026-08-20 ／ PM: クリーデ ／ 対応仕様: docs/20260820_prompt-vault_spec_m4a.md v1.0 ／ 本書一枚で完結

## 添付マニフェスト（着工前照合・必須）

| # | パス | 種別 | SHA-256 |
|---|---|---|---|
| 1 | docs/20260820_prompt-vault_spec_m4a.md | 仕様書 | — |
| 2 | docs/supplied/tokens.css | PM支給物（デザイントークン） | 4850377ad7e24581657e3117ed64e08b666f183ea05ede51240a13517db2eb07 |
| 3 | docs/supplied/danbooru-filtered.csv | PM支給物（タグ辞書） | fd9f677d2f0bdab7e1bf644a9ea76a1e5d861b7698e3b0d06a6158df465e13f7 |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航／セッション外プロセスの停止等の副作用がある操作。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**: PM支給物はdiffゼロで検収
3. **発注者指示による仕様外修正**: 報告時に明記。権威文書は書き換えない
4. **着工前**: `git pull` → inspect実行

## 作業範囲

- 何を: SQLiteインデックス・リスキャン・サムネイルキャッシュ・AlbumScreen書き直し（FSミラー＋サムネイルグリッド）
- なぜ: 要件定義v1.3 R-3（保管）・R-4（閲覧）。ギャラリー本装の基盤
- どこで: misfortunemate-png/prompt-vault-dev（main）

## 作業手順

### Step 1: npm依存追加

```bash
npm install better-sqlite3 sharp
```

**sharpのWindows環境（フラン）でのインストールに問題がある場合は停止・報告。** sharpはlibvipsのネイティブバイナリを必要とし、環境によってはビルドエラーが発生する。成功を確認してからStep 2へ。

### Step 2: SQLite基盤 (server/db.js)

1. `server/db.js` を新規作成。better-sqlite3でDBを初期化
2. テーブル・インデックス作成（仕様 §2.1のCREATE TABLE/INDEX）
3. DB初期化はサーバー起動時に `data/index.db` が存在しなければ自動実行
4. ヘルパー関数: `getByHash`, `upsertImage`, `deleteByHash`, `listByFolder`, `listFolders`, `getRecent`, `getStats`, `setThumbOk`

### Step 3: PNGメタデータパーサー (server/png-meta.js)

1. PNGバイナリからtEXt/iTXtチャンクを読み取る
2. NovelAI形式（キー `Comment` にJSON、キー `Description` にプロンプト）をパースして返す
3. パース失敗時はすべてNULLで返す（エラーにしない）
4. 外部ライブラリ不使用（PNGのチャンク解析は仕様が単純なので自前実装）

### Step 4: リスキャン・サムネイル生成 (server/scanner.js)

1. `startScan(vaultRoot)`: VAULT_ROOT再帰走査→ハッシュ計算→DB照合→INSERT/UPDATE/DELETE（仕様 §3.2）
2. ハッシュ計算: ファイル全体のSHA-256、先頭16文字hex
3. 新規画像はpng-meta.jsでメタデータ読み取り後にINSERT
4. サムネイル生成: `thumb_ok = 0` の画像に対してsharpで長辺300px WebP品質80→ `data/thumbs/{hash}.webp`。1枚ずつ直列処理
5. `data/thumbs/` ディレクトリは自動作成
6. 進捗状態を内部オブジェクトで管理（scanning, total, processed, newCount, movedCount, deletedCount）
7. サーバー起動時にVAULT_ROOTが設定済みならバックグラウンドでscan開始（`setImmediate` or `setTimeout(0)`）

### Step 5: サーバーAPI実装 (server.js)

1. ギャラリーAPI群を追加（仕様 §4.1〜§4.4）:
   - `GET /api/gallery` — フォルダツリー（DBからフォルダ一覧を取得しツリー構造に組み立て）
   - `GET /api/gallery/folder?path=` — 指定フォルダ内の画像一覧
   - `GET /api/gallery/recent?limit=` — 新着画像（既定20件・created_at降順）
   - `GET /api/gallery/image/:hash` — 画像メタデータ
   - `GET /api/gallery/stats` — インデックス統計
2. サムネイルAPI:
   - `GET /api/thumbs/:hash.webp` — サムネイル返却（Cache-Control: public, max-age=86400）。未生成時404
3. 原寸画像API:
   - `GET /api/images/full/:hash` — ハッシュからrel_pathを引きVAULT_ROOTのファイルを返却
4. リスキャンAPI:
   - `POST /api/rescan` — scanner.startScan呼び出し（既にスキャン中なら無視）
   - `GET /api/rescan/status` — 進捗返却
5. 保存API連携: `POST /api/save` の成功時に、保存したファイルを即時DB登録。`preset_id` パラメータ追加（任意）
6. M2の旧画像API（`/api/images`, `/api/images/:folder`, `/api/images/:folder/:filename`）は**残してもよいが、AlbumScreenからの参照を新APIに切り替える**。旧APIがM2結果カードの表示やインライン表示で使われている場合はそのまま維持

### Step 6: AlbumScreen書き直し

1. AlbumScreen.jsxを全面書き直し（仕様 §5）
2. ヘッダー行: パンくず（ルート > フォルダ名）＋🔄リスキャンボタン
3. ルート画面:
   - 新着セクション（直近20枚サムネイルグリッド）
   - フォルダツリー（`GET /api/gallery` のtreeを再帰レンダリング。フォルダタップで下位へ）
4. フォルダ画面:
   - サブフォルダがあれば表示
   - 画像グリッド（3列、サムネイルはアスペクト比維持の正方形クロップ）
   - サムネイル未生成時はプレースホルダー（灰色ボックス＋ローディングアイコン）
5. 画像タップ → 原寸表示（M4-Aでは現行の4象限ビューアを流用。前後移動・4象限タップナビは維持）
6. リスキャンUI: 🔄タップ→スピナー→3秒ポーリング→トースト通知→画面リフレッシュ（仕様 §5.4）

### Step 7: CLAUDE.md・inspect・version

1. CLAUDE.mdにM4-A API・SQLite・scanner・サムネイルの説明を追記
2. inspect.mjsの版確認を3.4.0に更新
3. package.json version → `3.4.0`
4. _STATUS.md更新（M4-Aセクション追加）

## 禁止事項

- docs/supplied/ 配下の改変
- React Router の導入
- better-sqlite3・sharp以外のnpm依存追加（PNGメタデータ解析は自前実装）
- VAULT_ROOT配下への.db/.webp等のキャッシュファイル配置（キャッシュはdata/配下に集約）

## テスト

仕様書 §8 のテスト方針に準拠。以下は特に重要な項目:

| 項目 | 手順 | 合格基準 |
|---|---|---|
| npm install | `npm install better-sqlite3 sharp` | エラーなし |
| DB初期化 | data/index.db削除→起動 | テーブル・インデックス自動生成 |
| 起動時リスキャン | VAULT_ROOTにPNG配置→起動 | DBに全ファイル登録・サムネイル生成 |
| 手動リスキャン | POST /api/rescan | scanning→完了。進捗APIで追跡可能 |
| メタデータ読取 | NovelAI生成PNG→リスキャン | prompt・seed・model等がDB記録 |
| 非NovelAI PNG | 通常のPNG→リスキャン | エラーにならない。prompt=NULL |
| ファイル移動検出 | 画像を別フォルダに移動→リスキャン | rel_path更新・hashは同一 |
| ファイル削除検出 | 画像をFS上で削除→リスキャン | DB行削除・サムネイル削除 |
| サムネイルAPI | GET /api/thumbs/{hash}.webp | WebP返却・Cache-Control付き |
| 原寸API | GET /api/images/full/{hash} | 原寸PNG返却 |
| フォルダツリー | GET /api/gallery | ネストしたツリー構造 |
| AlbumScreen表示 | アルバムタブ→フォルダ→画像グリッド | サムネイル表示・タップで原寸 |
| 保存→即時表示 | 生成→保存→アルバムタブ | リスキャン不要で即時表示 |
| リスキャンUI | 🔄→進捗→トースト | 正常動作 |
| build | npm run build | 警告なし |
| inspect | npm run inspect | ALL GREEN |

## 完了条件

- better-sqlite3・sharpのインストール成功
- リスキャン（起動時＋手動）がVAULT_ROOTを走査し、DB＋サムネイルを生成する
- NovelAI PNGメタデータが読み取られDBに記録される
- AlbumScreenがフォルダツリー＋サムネイルグリッドで表示される
- 生成→保存時にリスキャン不要で即時インデックス登録される
- inspect緑・_STATUS.md更新（version 3.4.0）

## 報告基準

報告は docs/reports/ に置く。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約
2. 完了条件の各項に対する充足状況
3. inspect結果
4. sharpインストール結果（成功/失敗・フラン環境の場合はプラットフォーム情報）
5. 未完了・未検証の項目
6. サーバー再起動・コミット・プッシュの実施状況
