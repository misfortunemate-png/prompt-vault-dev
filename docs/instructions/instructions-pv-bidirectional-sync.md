# prompt-vault presets下り同期＋settings同期 実装指示書

文書種別: 権威文書

作成日: 2026-09-04 ／ PM: クリーデ

## 背景

カード/プリセット/設定のデータがフラン⇔クラウドで双方向に同期されず、接続先によって見えるデータが異なる。フロントは同一なので、どちらに接続しても同じデータが見えるべき。

cards sync は双方向ロジックが実装済みだが、presets の cloud→fran 方向はフラン側に bulk PUT が存在しないためスキップされている。settings sync は関数自体が存在しない。

## 作業範囲

- prompt-vault-dev: server.js（PUT /presets bulk追加）
- ai-family-foundation: scripts/pv-sync.mjs（pvSettingsSync追加＋pv_settings_syncタイプ登録）

## 修正内容

### 修正1: フラン側 PUT /presets（bulk）追加（prompt-vault-dev server.js）

`api.put('/presets/:id', ...)` の **前** に、パスパラメータなしの `api.put('/presets', ...)` を追加。

```javascript
api.put('/presets', (req, res) => {
    writePresetsData(req.body);
    res.json({ ok: true });
});
```

writePresetsData は既存関数（presets.json をそのまま書き込む）。pv-sync.mjs が `{ version: 1, presets: [...] }` 形式で送る。

**注意:** Express のルーティングでは `/presets` と `/presets/:id` の順序が重要。`/presets` を先に定義すること。

### 修正2: pv_settings_sync 追加（ai-family-foundation pv-sync.mjs）

pvCardsSync / pvPresetsSync と同型の双方向同期関数を追加する。

```javascript
async function pvSettingsSync(counts) {
    appendLog('pv-sync', 'pv_settings_sync start');
    const [fr, cl] = await Promise.all([
        fetch(`${FRAN_BASE}/api/settings`, { headers: franHeaders() }),
        fetch(`${CLOUD_BASE}/api/prompt-vault/settings`, { headers: cloudHeaders() }),
    ]);
    if (!fr.ok) throw new Error(`fran /api/settings ${fr.status}`);
    if (!cl.ok) throw new Error(`cloud /api/prompt-vault/settings ${cl.status}`);

    const franData = await fr.json();
    const cloudData = await cl.json();

    if (sha256Json(franData) === sha256Json(cloudData)) {
        appendLog('pv-sync', 'pv_settings_sync: no diff');
        counts.pv_settings_sync = { synced: 0 };
        return;
    }

    // settings にはupdated_atがないので、cloud優先（外出先で変えた設定を持ち帰る方向）
    // ただしフランのみに存在するキー（sync.*等のローカル設定）は保持
    const merged = { ...franData };
    for (const [section, fields] of Object.entries(cloudData)) {
        if (typeof fields === 'object' && fields !== null) {
            merged[section] = { ...merged[section], ...fields };
        }
    }

    // 両方に書く
    const r1 = await fetch(`${FRAN_BASE}/api/settings`, {
        method: 'PUT', headers: franHeaders(), body: JSON.stringify(merged),
    });
    if (!r1.ok) throw new Error(`fran PUT /api/settings ${r1.status}`);

    const r2 = await fetch(`${CLOUD_BASE}/api/prompt-vault/settings`, {
        method: 'PUT', headers: cloudHeaders(), body: JSON.stringify(merged),
    });
    if (!r2.ok) throw new Error(`cloud PUT /api/prompt-vault/settings ${r2.status}`);

    appendLog('pv-sync', 'pv_settings_sync: merged and pushed to both');
    counts.pv_settings_sync = { synced: 1 };
}
```

### 修正3: pv_settings_sync をタイプ登録

pv-sync.mjs の `--type` 引数のディスパッチ部分と SYNC_TYPES に `pv_settings_sync` を追加。pvCardsSync / pvPresetsSync と同じパターン。

## テスト・検証手順

1. フランでserver.jsを再起動
2. `node scripts/pv-sync.mjs --once --type=pv_presets_sync` → "cloud wins, pushed to fran" または "no diff" が出ること（skip ではなく）
3. `node scripts/pv-sync.mjs --once --type=pv_settings_sync` → "merged and pushed to both" または "no diff" が出ること
4. フラン接続時に、クラウドで作ったプリセットが表示されること
5. フラン接続時の設定（model, steps等）がクラウドと一致すること

## 禁止事項

- pvCardsSync の既存ロジックに触らない
- pvPresetsSync の既存ロジックに触らない（bulk PUT の 405 スキップが自然に解消される）
- フロント側のコードに触らない

## 報告先

docs/reports/ に報告書を置く。
