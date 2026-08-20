# Prompt Vault M4-B 作業指示書
文書種別: 権威文書

作成日: 2026-08-20 ／ PM: クリーデ ／ 対応仕様: docs/20260820_prompt-vault_spec_m4b.md v1.0 ／ 本書一枚で完結

## 添付マニフェスト（着工前照合・必須）

| # | パス | 種別 | SHA-256 |
|---|---|---|---|
| 1 | docs/20260820_prompt-vault_spec_m4b.md | 仕様書 | — |
| 2 | docs/supplied/tokens.css | PM支給物 | 4850377ad7e24581657e3117ed64e08b666f183ea05ede51240a13517db2eb07 |
| 3 | docs/supplied/danbooru-filtered.csv | PM支給物 | fd9f677d2f0bdab7e1bf644a9ea76a1e5d861b7698e3b0d06a6158df465e13f7 |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航。原因判明時は「原因X・対策Y・実行可否」で報告し指示を待つ
2. **支給物改変禁止**
3. **発注者指示による仕様外修正**: 報告時に明記。権威文書は書き換えない
4. **着工前**: `git pull` → inspect

## 作業範囲

- 何を: ビューア本装（スワイプ・横向き）・お気に入り・検索・プリセット別アルバム・セリフ表示
- なぜ: 要件定義v1.3 R-4（閲覧・整理）・R-5（セリフ表示）
- どこで: misfortunemate-png/prompt-vault-dev（main）

## 作業手順

### Step 1: サーバーAPI追加 (server.js + server/db.js)

1. db.jsにヘルパー追加:
   - `setFavorite(hash, flag)` — `UPDATE images SET favorite = ? WHERE hash = ?`
   - `getFavorites(limit)` — `SELECT ... WHERE favorite = 1 ORDER BY created_at DESC LIMIT ?`
   - `search(query, limit)` — prompt/negative/folder/filename/captionに対するOR LIKE検索
   - `getByPreset(presetId, limit)` — `SELECT ... WHERE preset_id = ? ORDER BY created_at DESC LIMIT ?`
   - `setCaption(hash, text)` — `UPDATE images SET caption = ? WHERE hash = ?`

2. server.jsにAPI追加:
   - `PUT /api/gallery/image/:hash/favorite` — body: `{ favorite: 0|1 }` → db.setFavorite
   - `GET /api/gallery/favorites?limit=50` — db.getFavorites
   - `GET /api/gallery/search?q=&limit=50` — db.search。qが空なら400
   - `GET /api/gallery/by-preset/:presetId?limit=50` — db.getByPreset
   - `PUT /api/gallery/image/:hash/caption` — body: `{ caption: "..." }` → db.setCaption

### Step 2: ImageViewer.jsx（ビューア本装）

AlbumScreen.jsx内のインラインビューアを `src/components/ImageViewer.jsx` に分離。

Props: `images`（配列）, `initialIndex`, `onClose`, `onFavoriteToggle`, `onCaptionSave`

1. **スワイプ**: `touchstart`/`touchmove`/`touchend` でdx/dy計測。横方向|dx| > 50pxで前後切替。上方向|dy| > 80pxでビューア閉じる
2. **タップ前後**: 画面左1/4タップで前、右1/4タップで次。中央タップでオーバーレイ展開/折りたたみ
3. **×ボタン**: 右上に常時表示。タップでonClose
4. **情報オーバーレイ**: 画像下部に半透明バー。既定は折りたたみ（ファイル名＋★のみ）。タップで展開:
   - ファイル名、フォルダ、生成日時
   - プロンプト（正）: 3行切り捨て、タップで全文展開
   - プロンプト（負）: 同上
   - seed / model / steps / scale / sampler
   - ★お気に入りボタン（タップでPUT→トグル→アイコン切替）
   - セリフ表示エリア（§6参照）
5. **横向き**: CSSメディアクエリ `(orientation: landscape)` でオーバーレイを右サイドパネルに配置。画像は左側全高
6. **ピンチズーム**: `touchstart` で2点検出 → `touchmove` で距離変化 → CSS `transform: scale()` で拡縮。ダブルタップでリセット
7. 先頭/末尾でスワイプ → 何もしない（ループしない）

### Step 3: お気に入り

1. ImageViewer: ★/☆ボタン実装。現在の画像のfavoriteフラグに応じてアイコン切替。タップでonFavoriteToggle呼び出し → API → state更新
2. AlbumScreen: サムネイルグリッドのThumbCell内に小さな★アイコンオーバーレイ（`favorite === 1` の画像のみ、右上にゴールドの★）
3. AlbumScreen: ヘッダー行に★フィルタボタン。ON時は `GET /api/gallery/favorites` を呼んでフラットグリッド表示。パンくずに「お気に入り」を表示

### Step 4: 検索

1. AlbumScreen: ヘッダー行に🔍ボタン。タップで検索バー展開（テキスト入力＋🔍送信ボタン）
2. Enter or 送信ボタンで `GET /api/gallery/search?q={入力値}` を呼び出し
3. 結果をフラットなサムネイルグリッドで表示。各サムネイルの左下にフォルダ名を小さく半透明バッジで重ねる
4. パンくずに「検索: {キーワード}」を表示
5. 空文字では検索しない

### Step 5: プリセット別アルバム

1. AlbumScreen: ルート表示の新着セクションとフォルダセクションの間に「プリセット別」セクションを追加
2. `GET /api/presets` からプリセット一覧を取得し、水平スクロールのチップ行で表示
3. チップタップ → `GET /api/gallery/by-preset/:presetId` → フラットなサムネイルグリッド表示
4. パンくずに「プリセット: {プリセット名}」を表示
5. 画像が0件の場合は「このプリセットの画像はまだありません」を表示

### Step 6: セリフ表示・編集

1. ImageViewerの情報オーバーレイ内にセリフエリアを追加
2. captionがあれば表示。なければ「セリフなし」をグレー表示
3. セリフエリアをタップ → テキストエリアに切り替わり編集モード。保存ボタン＋キャンセルボタン
4. 保存 → `PUT /api/gallery/image/:hash/caption` → 確認後にテキスト表示に戻る

### Step 7: AlbumScreenからビューア分離

1. AlbumScreen.jsxから現行のインラインビューアコード（viewerImages/viewerIdx/handleViewerClick等）を除去
2. `<ImageViewer>` コンポーネントを配置。ビューア閉じた後の状態更新（お気に入り変更反映等）をコールバックで処理

### Step 8: CLAUDE.md・inspect・version

1. CLAUDE.mdにM4-B機能（ビューア・お気に入り・検索・プリセット別・セリフ）を追記
2. package.json version → `3.5.0`
3. _STATUS.md更新（M4-Bセクション追加）

## 禁止事項

- docs/supplied/ 配下の改変
- React Router の導入
- npm依存の追加（スワイプ検出・ピンチズームは自前実装）

## テスト

| 項目 | 手順 | 合格基準 |
|---|---|---|
| スワイプ前後 | ビューアで左右スワイプ | 画像切替 |
| タップ前後 | 画面左端/右端タップ | 画像切替 |
| ×閉じる | ×ボタン | ビューア閉じる |
| 上スワイプ閉じ | 上スワイプ | ビューア閉じる |
| オーバーレイ展開 | 下部バータップ | メタデータ表示 |
| ピンチズーム | 2本指ピンチ | 拡縮 |
| ダブルタップリセット | ダブルタップ | ズームリセット |
| お気に入りトグル | ★タップ | DB反映・アイコン切替 |
| お気に入りグリッド | お気に入り画像のサムネイル | ★オーバーレイ表示 |
| お気に入りフィルタ | ヘッダー★ON | お気に入りのみフラット表示 |
| 検索実行 | 🔍→テキスト→Enter | ヒット画像フラット表示 |
| 検索フォルダラベル | 検索結果サムネイル | フォルダ名バッジ |
| 検索空文字 | 空文字Enter | 検索されない |
| プリセット別 | チップタップ | 該当画像表示 |
| プリセット0件 | 画像なしプリセット | メッセージ表示 |
| セリフ表示 | ビューア→オーバーレイ展開 | セリフ or 「セリフなし」 |
| セリフ編集 | タップ→入力→保存 | DB反映・表示更新 |
| 横向き | orientation: landscape | オーバーレイが右サイドに |
| build | npm run build | 警告なし |
| inspect | npm run inspect | ALL GREEN |

## 完了条件

- ImageViewer.jsxが独立コンポーネントとして動作し、スワイプ・タップ・ピンチ・横向き対応
- お気に入りのトグル・フィルタ・グリッドオーバーレイが動作
- テキスト検索がプロンプト・フォルダ・ファイル名・セリフに対して動作
- プリセット別アルバムが動作
- セリフの表示・編集が動作
- inspect緑・_STATUS.md更新（version 3.5.0）

## 報告基準

報告は docs/reports/ に置く。コンテキスト圧縮後もこのセクションを読み返してから報告すること。

1. 実装内容の要約
2. 完了条件の各項に対する充足状況
3. inspect結果
4. 未完了・未検証の項目
5. サーバー再起動・コミット・プッシュの実施状況
