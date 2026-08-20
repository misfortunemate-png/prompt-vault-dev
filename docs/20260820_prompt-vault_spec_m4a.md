# Prompt Vault M4-A 仕様書 v1.0

文書種別: 権威文書
作成日: 2026-08-20 ／ PM: クリーデ ／ 根拠: 要件定義v1.3 R-3（保管）・R-4（閲覧）・NF（サムネイルキャッシュ）

## §1 スコープ

M4-Aはギャラリー本装の基盤層。SQLiteインデックス・リスキャン・サムネイルキャッシュ・FSミラー表示を実装する。

- In: SQLiteインデックス（中央DB）、リスキャン（起動時＋手動）、サムネイルキャッシュ（sharp）、AlbumScreen書き直し（FSミラーツリー＋サムネイルグリッド）、画像メタデータ読み取り（NovelAI PNG埋め込み）
- Out（M4-B）: ビューア本装（スワイプ・横向き）、お気に入り、検索、プリセット別アルバム、セリフ表示

## §2 データモデル

### §2.1 SQLiteインデックス

`data/index.db` にSQLiteデータベースを配置する。依存: `better-sqlite3`（npm追加）。

```sql
CREATE TABLE images (
  hash        TEXT PRIMARY KEY,   -- コンテンツSHA-256（先頭16文字hex）
  rel_path    TEXT NOT NULL,      -- VAULT_ROOTからの相対パス（例: "キャラA/制服_2847103956.png"）
  filename    TEXT NOT NULL,      -- ファイル名
  folder      TEXT NOT NULL,      -- フォルダパス（例: "キャラA"、ネスト時は "作品/キャラA"）
  size_bytes  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,      -- ファイル作成日時（ISO 8601）
  modified_at TEXT NOT NULL,      -- ファイル更新日時（ISO 8601）
  width       INTEGER,           -- 画像幅（PNGヘッダから）
  height      INTEGER,           -- 画像高さ（PNGヘッダから）
  prompt      TEXT,              -- 正プロンプト（NovelAI PNGメタデータから）
  negative    TEXT,              -- 負プロンプト（同上）
  seed        INTEGER,           -- シード値（同上）
  model       TEXT,              -- モデル名（同上）
  steps       INTEGER,           -- ステップ数（同上）
  scale       REAL,              -- スケール値（同上）
  sampler     TEXT,              -- サンプラー名（同上）
  preset_id   TEXT,              -- 生成時のプリセットID（M3のプリセットとの紐づけ。NULL可）
  favorite    INTEGER DEFAULT 0, -- お気に入りフラグ（M4-Bで使用。0/1）
  caption     TEXT,              -- セリフ/キャプション（M4-Bで使用。NULL可）
  thumb_ok    INTEGER DEFAULT 0, -- サムネイル生成済みフラグ（0/1）
  indexed_at  TEXT NOT NULL       -- インデックス登録日時
);

CREATE INDEX idx_folder ON images(folder);
CREATE INDEX idx_created ON images(created_at);
CREATE INDEX idx_favorite ON images(favorite);
```

- `hash` はファイル全体のSHA-256の先頭16文字。ファイルが移動・リネームされても同一画像を同定できる
- `favorite`・`caption` のカラムはM4-Aで作成するがM4-Bまで使用しない（スキーマだけ先行）
- `preset_id` はM3の生成時に保存APIで受け取ったプリセットIDを記録。後方互換のためNULL可

### §2.2 サムネイルキャッシュ

`data/thumbs/` ディレクトリに `{hash}.webp` として保存。依存: `sharp`（npm追加）。

- サイズ: 長辺300px、WebP品質80
- 生成タイミング: リスキャン時にバックグラウンドで生成
- サムネイルが未生成の画像にはプレースホルダーを表示

## §3 リスキャン

### §3.1 トリガー

1. **起動時**: サーバー起動直後にバックグラウンドでリスキャンを開始（APIレスポンスをブロックしない）
2. **手動**: `POST /api/rescan` で手動実行

### §3.2 処理フロー

1. VAULT_ROOT配下を再帰走査し、すべての `.png` ファイルを列挙
2. 各ファイルのSHA-256ハッシュ（先頭16文字）を計算
3. **新規**: ハッシュがDBにないファイル → メタデータ読み取り → INSERT → サムネイル生成キューに追加
4. **移動/リネーム**: ハッシュがDBにあるが `rel_path` が異なる → UPDATEで `rel_path`・`folder`・`filename`・`modified_at` を更新
5. **削除**: DBにあるがFS上にないハッシュ → DELETEで行を削除 → サムネイルファイルも削除
6. **変更なし**: ハッシュも `rel_path` も一致 → スキップ

### §3.3 NovelAI PNGメタデータ読み取り

NovelAIが生成したPNGには `tEXt` チャンクに以下が埋め込まれている:
- キー `Comment`: JSON文字列（`prompt`, `uc`（negative）, `seed`, `steps`, `scale`, `sampler`, `model` 等）
- キー `Description`: 正プロンプト

読み取り方: PNGバイナリから `tEXt`/`iTXt` チャンクを解析する。パース失敗（NovelAI以外のPNG、メタデータなし）は `prompt` 等をNULLのまま登録し、エラーにしない。

### §3.4 サムネイル生成

リスキャン中に `thumb_ok = 0` の画像を検出したら、sharpでWebPサムネイルを生成し、`data/thumbs/{hash}.webp` に保存。生成成功後に `thumb_ok = 1` に更新。

大量の画像がある場合のCPU負荷を考慮し、1枚ずつ直列で処理する（並列化しない）。

### §3.5 進捗通知

リスキャン中はAPIで進捗を返せるようにする。

- `GET /api/rescan/status` → `{ scanning: true|false, total: N, processed: N, newCount: N, movedCount: N, deletedCount: N }`
- フロントはポーリング（3秒間隔）で進捗表示

## §4 API（M4-A追加・変更分）

### §4.1 インデックスAPI

| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/gallery | フォルダツリー取得（FSミラー） |
| GET | /api/gallery/folder?path={path} | 指定フォルダ内の画像一覧（サムネイルURL付き） |
| GET | /api/gallery/recent?limit={n} | 新着画像（既定20件） |
| GET | /api/gallery/image/:hash | 画像メタデータ取得 |
| GET | /api/gallery/stats | インデックス統計（総数・フォルダ数・サムネイル生成済み数） |

### §4.2 サムネイルAPI

| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/thumbs/:hash.webp | サムネイル画像取得（キャッシュヘッダ付き） |

- `Cache-Control: public, max-age=86400`（24時間）
- 未生成時は404（フロントがプレースホルダー表示）

### §4.3 原寸画像API（既存改訂）

| メソッド | パス | 用途 |
|---|---|---|
| GET | /api/images/full/:hash | 原寸画像取得（ハッシュベース） |

M2の `/api/images/:folder/:filename` はパスベースだったが、M4-Aからはハッシュベースに移行する。フロントがサムネイル→原寸の遷移時にハッシュで参照できるようにする。旧パスベースAPIはAlbumScreenからの参照がなくなるため廃止して構わない。

### §4.4 リスキャンAPI

| メソッド | パス | 用途 |
|---|---|---|
| POST | /api/rescan | リスキャン手動実行 |
| GET | /api/rescan/status | リスキャン進捗取得 |

### §4.5 保存API連携（既存改訂）

`POST /api/save` の成功時に、保存した画像を即時インデックスに登録する（リスキャンを待たない）。M3で実装済みの `seed` を `images.seed` に記録。生成時のプリセットIDも受け取れるように `preset_id` パラメータを追加（任意）。

## §5 AlbumScreen書き直し（FSミラー）

M2のAlbumScreenを書き直す。

### §5.1 レイアウト

1. **ヘッダー行**: パンくず（ルート > フォルダ名 > ...）＋リスキャンボタン（🔄）＋リスキャン進捗表示
2. **新着セクション**（ルートのみ）: 直近20枚をサムネイルグリッドで表示
3. **フォルダツリー**: VAULT_ROOTのフォルダ構造をそのまま表示。フォルダタップで下位階層へ。ネストあり（作品名/キャラ名/...）
4. **画像グリッド**: フォルダ内の画像をサムネイルで表示。タップで原寸表示（M4-Aでは簡易ビューア、M4-Bで本装）

### §5.2 フォルダツリー

`GET /api/gallery` が返すツリー構造:

```json
{
  "tree": [
    {
      "name": "キャラA",
      "path": "キャラA",
      "imageCount": 15,
      "children": []
    },
    {
      "name": "オリジナル",
      "path": "オリジナル",
      "imageCount": 0,
      "children": [
        {
          "name": "キャラB",
          "path": "オリジナル/キャラB",
          "imageCount": 8,
          "children": []
        }
      ]
    }
  ],
  "totalImages": 23,
  "totalFolders": 3
}
```

フォルダ行: フォルダアイコン＋名前＋画像枚数。画像が0枚のフォルダも表示する（サブフォルダへの導線）。

### §5.3 画像グリッド

`GET /api/gallery/folder?path={path}` が返すデータ:

```json
{
  "path": "キャラA",
  "images": [
    {
      "hash": "a1b2c3d4e5f6g7h8",
      "filename": "制服_2847103956.png",
      "thumbUrl": "/api/thumbs/a1b2c3d4e5f6g7h8.webp",
      "created_at": "2026-08-20T15:30:00+09:00",
      "width": 832,
      "height": 1216
    }
  ],
  "subfolders": [...]
}
```

- グリッド: 3列（モバイル）。サムネイルはアスペクト比を維持しつつ正方形クロップで統一
- タップで原寸表示（M4-Aでは現行の4象限ビューアを維持。M4-Bでスワイプ・横向き対応に置き換え）

### §5.4 リスキャンUI

- 🔄ボタンタップ → `POST /api/rescan` → ボタンがスピナーに変化
- 3秒ポーリングで `GET /api/rescan/status` → 「スキャン中: 150/320枚」のように進捗表示
- 完了 → トースト「リスキャン完了: 新規N枚、移動N枚、削除N枚」→ 画面リフレッシュ

## §6 npm依存追加

| パッケージ | 用途 | 補足 |
|---|---|---|
| better-sqlite3 | SQLiteインデックス | Node.jsネイティブ。同期API（Express環境に適合） |
| sharp | サムネイル生成 | WebPリサイズ。libvips依存（フランのWindows環境で事前確認必要） |

`npm install better-sqlite3 sharp` をPG作業のStep 1で実行。sharpのWindows環境インストールに問題がある場合は停止・報告（停止条件）。

## §7 ファイル構成（M4-A追加分）

```
server/
  db.js                        ← SQLite初期化・ヘルパー
  scanner.js                   ← リスキャン・メタデータ読取・サムネイル生成
  png-meta.js                  ← NovelAI PNGメタデータパーサー
data/
  index.db                     ← SQLiteデータベース（.gitignore対象）
  thumbs/                      ← サムネイルキャッシュ（.gitignore対象）
```

## §8 テスト方針

### PG自己完結

| 項目 | 手順 | 合格基準 |
|---|---|---|
| DB初期化 | data/index.db削除→起動 | テーブル・インデックス生成 |
| 起動時リスキャン | VAULT_ROOTに数枚のPNG配置→起動 | 全ファイルがDBに登録。コンソールにサマリー |
| 手動リスキャン | POST /api/rescan | scanning: true→完了→scanning: false |
| 新規検出 | VAULT_ROOTに画像追加→リスキャン | 新規レコードINSERT |
| 移動検出 | VAULT_ROOT内で画像を別フォルダに移動→リスキャン | rel_path更新・hashは同一 |
| 削除検出 | VAULT_ROOTから画像削除→リスキャン | DBから削除・サムネイルも削除 |
| メタデータ読取 | NovelAI生成のPNG→リスキャン | prompt・seed・model等がDBに記録 |
| メタデータなしPNG | 非NovelAIのPNG→リスキャン | prompt=NULL・エラーにならない |
| サムネイル生成 | リスキャン後 | data/thumbs/{hash}.webp が生成・thumb_ok=1 |
| サムネイルAPI | GET /api/thumbs/{hash}.webp | WebP画像返却・Cache-Control付き |
| 原寸API | GET /api/images/full/{hash} | 原寸PNG返却 |
| フォルダツリーAPI | GET /api/gallery | ネストしたフォルダ構造が返る |
| フォルダ内一覧API | GET /api/gallery/folder?path=... | 画像一覧（hash・thumbUrl付き） |
| 新着API | GET /api/gallery/recent | 直近N枚が返る |
| AlbumScreenツリー | フォルダタップ→パンくず更新 | 階層ナビゲーション正常 |
| AlbumScreenグリッド | フォルダ内のサムネイル表示 | サムネイル表示・タップで原寸 |
| 保存→即時インデックス | 生成画面で保存→アルバム | リスキャン不要で即時表示 |
| build | npm run build | 警告なし |
| inspect | npm run inspect | ALL GREEN |

### 実機（発注者に依頼）

- sharpのフランWindows環境でのインストール確認
- Pixel 10からのサムネイルグリッド表示速度（特に100枚以上のフォルダ）
- リスキャンの実行時間目安（フランの画像枚数次第）

## 改訂履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-08-20 | v1.0 | 初版（PM起草） |
