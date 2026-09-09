# Phase 5D-4 即修正バッチ 作業指示書
文書種別: 権威文書

作成日: 2026-09-10 ／ PM: クリーデ ／ 本書一枚で完結（追補なし）
起因: 外部レビューPhase 5D-4の診断結果から、独立に修正できる2件。

## 添付マニフェスト（着工前照合・必須）

| # | 参照 | 種別 |
|---|---|---|
| 1 | Phase 5D-4完了報告 — 発見事項1（同期部分失敗） | 外部レビュー診断結果 |
| 2 | Phase 5D-4完了報告 — 発見事項3（NovelAI無期限停止） | 外部レビュー診断結果 |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航
2. **着工前**: 各リポジトリで `git pull` → inspect

## 作業範囲

- **リポジトリ1**: ai-family-foundation — `scripts/pv-sync.mjs` のエラー報告修正
- **リポジトリ2**: prompt-vault-dev — `server/providers/novelai.js` のfetch timeout追加
- **触らないもの**: sync仕様（LWW方向・tombstone設計）、Cloud側resolve handler、healthz

---

## 手順1: pv-sync.mjs の部分失敗→成功扱い修正（ai-family-foundation）

### 問題

各sync関数（pvImageDown, pvImageUp, pvMetaSync）は個別エラーを`errors`変数に数えてcountsに書き出すが、`globalOk`は各sync関数が**例外を投げた場合のみ**falseになる。個別エラーが積み上がっても例外は投げないため、全件失敗でもglobalOk=true・終了コード0になる。

resolveEntryも通信失敗をappendLogするだけで呼び出し元に伝えない。

### 修正A: globalOkにcountsのerror集計を反映

L728（forループ終了後）とL731（summary構築）の間に、countsからエラーを集計する処理を追加:

```javascript
  // ── counts のエラーを globalOk に反映 ──
  for (const [type, c] of Object.entries(counts)) {
    const errCount = (c.errors || 0) + (c.deleteErrors || 0);
    if (errCount > 0) {
      globalOk = false;
      process.exitCode = 2; // REPAIR_REQUIRED（1=FATAL、2=部分失敗）
    }
  }
```

終了コードの使い分け:
- 0: 全成功
- 1: FATAL（既存のcatchブロック・設定不備等。変更なし）
- 2: 部分失敗（一部のアイテムでエラー発生）

### 修正B: resolveEntryの失敗を呼び出し元に返す

resolveEntry（L142-156）を修正して、通信失敗時に戻り値で通知する:

```javascript
async function resolveEntry(type, itemId, direction, status, payload = null, error = null) {
  const entry = { type, item_id: itemId, direction, status };
  if (payload !== null) entry.payload = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (error !== null) entry.error = String(error).slice(0, 500);
  try {
    const res = await fetch(`${CLOUD_BASE}/api/prompt-vault/sync/resolve`, {
      method: 'POST',
      headers: cloudHeaders(),
      body: JSON.stringify({ entries: [entry] }),
    });
    if (!res.ok) {
      appendLog('pv-sync', `resolve HTTP ${res.status} for ${type}/${itemId}`);
      return false;
    }
    return true;
  } catch (e) {
    appendLog('pv-sync', `resolve error: ${e.message}`);
    return false;
  }
}
```

呼び出し側は戻り値を強制的にチェックする必要はない。resolveの通信失敗はデータの失敗とは別の軸であり（データ自体はCloud/Franに残っている）、ログに記録されていれば十分。ただし戻り値が使えるようになることで、将来的にresolve失敗をcountsに含めることが可能になる。

### 修正C: summaryのcountsにerror合計を含める

L731のsummaryにエラー合計を明示:

```javascript
  const totalErrors = Object.values(counts).reduce((sum, c) => sum + (c.errors || 0) + (c.deleteErrors || 0), 0);
  const summary = {
    agent: 'pv-sync.mjs',
    started_at: startedAt,
    finished_at: finishedAt,
    ok: globalOk,
    total_errors: totalErrors,
    counts,
  };
```

コミット: `fix: sync partial failure now sets globalOk=false and exitCode=2`

---

## 手順2: NovelAI fetch の timeout追加（prompt-vault-dev）

### 問題

`server/providers/novelai.js` L96のfetchにtimeoutがない。NovelAIが応答しない場合、Promiseが未完了のまま残り、単発生成は永久停止、queue実行中タスクはrunning固定、stop要求もfetch完了まで処理されず、復旧にserver再起動が必要。

### 修正

L96のfetch呼び出しにAbortSignal.timeoutを追加:

```javascript
  const GENERATE_TIMEOUT_MS = 120_000; // 2分

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: prompt, model, action: 'generate', parameters }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });
```

AbortSignal.timeout()はNode.js 18+で使用可能（フランはv24.15.0）。fetch中断時は`TimeoutError`が投げられ、呼び出し元（generate.jsのexecuteGenerate）の既存catchで捕まる。

タイムアウト値の根拠: NovelAIの通常応答は10-30秒。120秒はその4倍以上で、高解像度・高ステップの余裕を含む。異常停止の検出が目的であり、通常操作に影響しない値。

定数をファイル冒頭に配置してもよい:

```javascript
const API_URL = 'https://image.novelai.net/ai/generate-image';
const GENERATE_TIMEOUT_MS = 120_000;
```

コミット: `fix: add 120s timeout to NovelAI generate fetch`

---

## 禁止事項

- sync仕様の変更（LWW方向・tombstone・resolve handlerの動作）
- Cloud側resolve endpointの変更
- healthzの変更
- queue.jsの変更（インメモリqueue設計は仕様どおり）

## テスト

- PG自己完結分:
  - ai-family-foundation: `node scripts/inspect.mjs` 緑
  - prompt-vault-dev: `npm run inspect`（既存赤以外に新規赤なし）
  - prompt-vault-dev: `npm run build` 成功
  - 手順1: pv-sync.mjsを`--type pv_settings_sync`等の安全な単一typeで実行し、errorなし時にexitCode=0であることを確認
  - 手順2: novelai.jsのtimeout定数が存在することをgrepで確認（実際のtimeout発火テストはNOT RUN）
- NOT RUN:
  - 実際のsync部分失敗テスト（D1/Fran障害注入）
  - 実際のNovelAI無応答テスト
  - Worker再デプロイ（今回はfoundation側にWorker変更なし。pv-sync.mjsはフラン上スクリプト）
- Issue Verifier: 今回の修正に対応するverifierは未登録。外部レビュアーの判断で追加する

## 完了条件

- 2件の修正が各リポジトリでコミット・push済み
- 各inspect合格
- pv-sync.mjsのglobalOk判定がcountsのerrorsを参照していること
- novelai.jsのfetchにsignal: AbortSignal.timeout()が含まれること

## 報告基準

報告は prompt-vault-dev の docs/reports/ に置く。

1. 実装内容の要約（手順1〜2の結果）
2. 完了条件の充足状況
3. inspect結果
4. NOT RUN項目
5. exitCode=2の実装有無（手順1）
6. timeout定数の値（手順2）
