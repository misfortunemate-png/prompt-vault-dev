# Phase 5D-4 即修正バッチ 完了報告（foundation #部分失敗, pv-dev #NovelAI timeout）

作成日: 2026-09-10 ／ PG: Claude Sonnet 4.6

---

## 1. 実装内容の要約

### 手順1: pv-sync.mjs の部分失敗→成功扱い修正（ai-family-foundation）

**修正A: resolveEntry の戻り値追加**

`resolveEntry`（L142-156）が HTTP エラー・例外時に `return false` を返すよう変更。成功時は `return true`。将来的に呼び出し元が resolve 失敗を counts に含める際に使用可能。

**修正B: counts のエラーを globalOk に反映**

for ループ終了直後（元 L728 → L728-737）に counts のエラー集計処理を追加:
```javascript
for (const [, c] of Object.entries(counts)) {
  const errCount = (c.errors || 0) + (c.deleteErrors || 0);
  if (errCount > 0) {
    globalOk = false;
    process.exitCode = 2; // REPAIR_REQUIRED（1=FATAL、2=部分失敗）
  }
}
```

終了コードの使い分け:
- 0: 全成功
- 1: FATAL（既存 catch ブロック・設定不備）
- 2: 部分失敗（個別アイテムのエラー）

**修正C: summary に total_errors フィールド追加**

```javascript
const totalErrors = Object.values(counts).reduce((sum, c) => sum + (c.errors || 0) + (c.deleteErrors || 0), 0);
const summary = { agent: 'pv-sync.mjs', ..., ok: globalOk, total_errors: totalErrors, counts };
```

コミット: `6092aa0`

---

### 手順2: NovelAI fetch の timeout 追加（prompt-vault-dev）

`server/providers/novelai.js` に定数追加と signal 追加:
```javascript
const GENERATE_TIMEOUT_MS = 120_000;
// ...
signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
```

タイムアウト時は `TimeoutError` が投げられ、`executeGenerate` 側の既存 catch で捕まる。

コミット: `6844663`

---

## 2. 完了条件の充足状況

| 条件 | 状態 |
|---|---|
| 2件の修正がコミット・push 済み | ✅ |
| ai-family-foundation inspect 緑 | ✅ |
| pv-dev inspect: 既存2件以外に新規赤なし | ✅ |
| pv-sync.mjs の globalOk 判定が counts.errors を参照 | ✅ |
| novelai.js の fetch に signal: AbortSignal.timeout() が含まれる | ✅ |

---

## 3. inspect 結果

**ai-family-foundation**:
```
=== 静的検査: ✅ 緑 (all pass) ===
```

**prompt-vault-dev**:
```
❌ マニフェスト照合: FAILED（既存既知）
❌ 支給物SHA-256照合: FAILED（既存既知）
✅ 版確認
✅ _STATUS.md 行数
✅ danbooru-filtered.csv SHA-256
✅ ビルド確認
```
新規赤: **0件**

---

## 4. NOT RUN

- 実際の sync 部分失敗テスト（D1/Fran 障害注入）
- 実際の NovelAI 無応答テスト（timeout 発火確認）
- exitCode=2 の実行確認（`--type pv_settings_sync` 等での正常系は NOT RUN。コード確認のみ）

---

## 5. exitCode=2 の実装有無（手順1）

実装済み。`process.exitCode = 2` は `counts` から集計したエラー数が 1 以上の場合に設定される。

---

## 6. timeout 定数の値（手順2）

```
GENERATE_TIMEOUT_MS = 120_000 （120秒）
```

NovelAI の通常応答 10-30 秒に対し 4 倍以上の余裕。Node.js 24.15.0 で `AbortSignal.timeout()` 使用可能（Node.js 18+ 対応）。

---

## 7. コミット・プッシュ状況

| リポジトリ | コミット | 内容 |
|---|---|---|
| ai-family-foundation | `6092aa0` | fix: sync partial failure now sets globalOk=false and exitCode=2 |
| prompt-vault-dev | `6844663` | fix: add 120s timeout to NovelAI generate fetch |
