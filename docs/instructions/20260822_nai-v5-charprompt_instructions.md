# prompt-vault NAI V5対応・キャラプロンプト検証 作業指示書
文書種別: 権威文書

作成日: 2026-08-22 ／ PM: クリーデ ／ 本書一枚で完結

## PG運用規律（定型）

1. 停止条件: 仕様にない判断が必要／技術的に実現困難／難航。報告して指示を待つ
2. 発注者指示による仕様外修正: 実施可。報告時に明記
3. 着工前: `git pull`

## 背景

2026-08-21にNovelAI Diffusion V5がリリースされた（V5 Full / V5 Curated）。本指示書ではV5モデルの追加とPoC確認、およびv3.9.0で実装済みのキャラクタープロンプト読み取りの実機検証を行う。

V5の主な技術差分:
- モデルサイズがV4.5の2倍以上、32チャンネルVAE（V4.5は16チャンネル）
- 自然言語理解の強化、日本語プロンプト公式対応
- キャラクター配置がグリッド式→自由配置に変更
- プロンプトトークン上限の拡大
- アルファ透明度のネイティブサポート
- Opus契約者にもV5のみ利用上限あり（V4.5以前は無制限のまま）

## 作業一覧（3件）

| # | 内容 | 対象 |
|---|---|---|
| 1 | V5モデルの追加（UI＋プロバイダー） | GenerateScreen.jsx, server/providers/novelai.js |
| 2 | V5生成PoC | curl or node script |
| 3 | キャラプロンプト読み取りの実機検証 | server/png-meta.js（修正が必要な場合のみ） |

---

### #1: V5モデルの追加

#### §1.1 GenerateScreen.jsx — MODELS配列

```javascript
const MODELS = [
  { value: 'nai-diffusion-5-full',       label: 'V5 Full ⚡' },
  { value: 'nai-diffusion-5-curated',    label: 'V5 Curated ⚡' },
  { value: 'nai-diffusion-4-5-full',     label: 'V4.5 Full' },
  { value: 'nai-diffusion-4-5-curated',  label: 'V4.5 Curated' },
  { value: 'nai-diffusion-4-full',       label: 'V4 Full' },
  { value: 'nai-diffusion-3',            label: 'V3' },
];
```

- V5のラベルに⚡を付けて利用上限ありを視覚的に示す
- **デフォルトモデルは`nai-diffusion-4-5-full`のまま変更しない**（generate.jsのL12、GenerateScreenのL125, L509）

#### §1.2 server/providers/novelai.js — リクエスト構造

現在の `isV3` 分岐を拡張する。V5がV4系と同じ `v4_prompt` 構造を使うか、新しい構造が必要かを#2のPoCで判定する。

**仮定（PoC前）**: V5はV4.5の拡張であり、`v4_prompt` 構造をそのまま使える。PoCで確認し、異なる場合はこの仮定を修正して報告する。

```javascript
const isV3 = model === 'nai-diffusion-3';
const isV5 = model.startsWith('nai-diffusion-5');
```

V5固有のパラメータが必要かどうかもPoCで確認する。不要ならisV5の分岐は不要（V4系と同一パス）。

#### §1.3 モデル文字列の確認

V5のAPIモデル文字列が `nai-diffusion-5-full` / `nai-diffusion-5-curated` であることを#2のPoCで確認する。異なる場合はMODELS配列のvalueを修正し、報告に正しい文字列を明記する。

**確認方法**: NovelAI公式サイト（novelai.net）でV5画像を生成し、生成画像のPNGメタデータ（Commentチャンク）内の `model` フィールドの値を読む。ただしWebサイトでの生成はAnlasまたは利用上限を消費するため、発注者の判断で行う。**PGが確認できない場合は、推定値で実装し報告に「モデル文字列未確認」と明記する。停止しなくてよい。**

---

### #2: V5生成PoC

NOVELAI_TOKENを使い、V5 Fullで1枚生成する。

```bash
# prompt-vault-devのルートで実行
node -e "
  import('./server/providers/novelai.js').then(async ({ generate }) => {
    try {
      const r = await generate({
        prompt: '1girl, silver hair, blue eyes, best quality',
        negativePrompt: 'lowres, bad anatomy',
        model: 'nai-diffusion-5-full',
        width: 832, height: 1216,
        steps: 28, scale: 5,
        sampler: 'k_euler_ancestral',
        seed: null,
        vaultRoot: process.env.VAULT_ROOT || './data'
      });
      console.log('SUCCESS:', JSON.stringify(r));
    } catch (e) {
      console.error('FAIL:', e.message);
    }
  });
"
```

**確認事項と報告**:

1. HTTPステータス（200 or エラー）
2. エラーの場合: レスポンス本文の最初300文字
3. 成功の場合:
   a. 生成されたPNGのメタデータを `parsePngMeta` で読み、`model` フィールドの値を報告
   b. V4.5と異なるフィールドがあれば報告
   c. `v4_prompt` 構造がレスポンスに含まれているか
4. もし `nai-diffusion-5-full` でエラーなら、以下を順に試す:
   - `nai-diffusion-v5-full`
   - `nai-diffusion-5`
   - `novelai-diffusion-5-full`
   成功した文字列を報告

**PoCで判明した差分への対応**:
- リクエスト構造に差分があった場合: §1.2のプロバイダーコードを修正
- メタデータ構造に差分があった場合: #3の対応に含める
- モデル文字列が推定と異なった場合: §1.1のMODELS配列を修正

---

### #3: キャラプロンプト読み取りの実機検証

v3.9.0で `server/png-meta.js` に `v4_prompt.caption.char_captions` の読み取りコードが追加されている。

**検証手順**:

1. `VAULT_ROOT` 内にNAI v4.5のキャラプロンプト付き画像が存在するか確認
2. 存在する場合: `POST /api/rescan` を実行し、rescan完了後に `GET /api/gallery/image/:hash` でpromptフィールドを確認
3. promptにキャラプロンプト部分（char_captions内の文字列）が含まれていれば合格
4. 含まれていなければ、該当画像のPNGメタデータを直接読んで原因を調査し報告

**既存画像がない場合**: V4.5でキャラプロンプト付き画像を1枚生成し（プロンプトにキャラクター配置を含める）、上記手順で検証する。生成にAnlasは消費しない（V4.5 Opus無制限）。

**V5メタデータへの追加対応**: #2のPoCで生成したV5画像のメタデータを確認し、キャラクタープロンプトの格納構造がV4.5と異なる場合は `parseNovelAiChunk` に対応コードを追加する。構造が同じであれば追加不要。

---

## version

package.json version → `3.10.0`

## 禁止事項

- デフォルトモデルの変更（`nai-diffusion-4-5-full` のまま維持）
- npm依存の追加
- 既存のV3/V4/V4.5生成機能への影響

## テスト

| # | 対象 | 合格条件 |
|---|---|---|
| 2a | V5 PoC | V5 Fullで画像が1枚生成されること（またはモデル文字列の正解が判明すること） |
| 2b | V5メタデータ | 生成画像のメタデータが parsePngMeta で正しく読めること |
| 1 | V5モデルUI | モデルプルダウンにV5 Full⚡ / V5 Curated⚡ が表示されること |
| 3a | キャラプロンプト | V4.5キャラプロンプト付き画像のrescan後にpromptが正しく読めること |
| 3b | V5キャラプロンプト | V5画像のメタデータが正しく読めること |
| 既存 | V4.5生成 | V4.5 Fullで従来通り生成・保存できること |
| build | ビルド | npm run build 警告なし |

## 完了条件

- #1 V5モデルがUIに表示され選択できる
- #2 V5 PoCの結果（成功 or 失敗理由）が報告に明記されている
- #3 キャラプロンプト読み取りの検証結果が報告に明記されている
- V4.5の既存機能が壊れていない
- ビルド・サーバー再起動・コミット・プッシュ実施済み
- _STATUS.md更新（version 3.10.0）

## 報告基準

報告は docs/reports/ に置く。

1. 各項目（#1〜#3）の実装・検証内容の要約
2. **V5 PoCの詳細結果**（成否・使用したモデル文字列・レスポンス概要・メタデータ内容）
3. **キャラプロンプト検証の詳細結果**（対象画像・読み取り結果・V4.5とV5の構造差分）
4. 完了条件の充足状況
5. サーバー再起動・コミット・プッシュの実施状況
