# 契約統一とschema汚染除去 作業指示書
文書種別: 権威文書

作成日: 2026-09-10 ／ PM: クリーデ
上位文書: ai-family-ops/docs/20260910_pv-review2_remediation-policy_v1.0.md
対象Issue: ai-family-foundation #3（cards bulk PUT camelCase/snake_case不一致）
統合Issue: prompt-vault-dev #36（cards.json 38件のschema汚染）
PM判断: ai-family-foundation #15（presets APIフィールド破棄）は②に回す（D1スキーマ変更を要するため§1-3スコープ外）

## 添付マニフェスト（着工前照合・必須）

| # | 参照 | 種別 |
|---|---|---|
| 1 | ai-family-foundation #3 | 外部レビュー指摘（PM事実確認済み） |
| 2 | prompt-vault-dev #36 | 外部レビュー指摘（doctor出力で確認済み） |
| 3 | 方針書 §2-① | 退避・evidence手順の制約 |
| 4 | 方針書 §3 | pv_cards_sync停止中の前提 |

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難または難航
2. **支給物改変禁止**（本工程は支給物なし）
3. **着工前**: 各リポジトリで `git pull` → inspect

## 裁定事項（方針書§1から引用・PGは遵守）

- **裁定A**: canonical API schema＝camelCase。snake_caseはCloud D1境界の内側のみ
- **N=1 endpoint handoff**: FranとCloudを同時編集しない前提。双方向multi-master LWWは実装しない
- **§0**: 新たな機能や基盤改変は行わない。コード修正と再発防止のみ

## 作業範囲

- **何を**: Cloud PUT /cardsのcamelCase受理、pv-sync.mjsのsnake_case変換撤去、Fran cards.json既存38件の正常化
- **どこで**: ai-family-foundation + prompt-vault-dev
- **触らないもの**: presetsスキーマ（#15は②）、sync仕様のLWW方向・tombstone設計、D1 migration追加

---

## 手順1: 修復前evidence採取（prompt-vault-dev・最初に実行）

#34（JSON原地上書き）が未修正のため、万一のデータ保全を先に行う。

**1-A: cards.jsonのSHA-256記録**

```
cd D:\AI\github\prompt-vault-dev
certutil -hashfile data\cards.json SHA256
```

出力されたハッシュ値をdocs/reports/に記録する。

**1-B: doctor実行（修復前evidence）**

```
git checkout chatgpt/review-doctor-20260909
npm run doctor:json > docs/reports/evidence-cards-before.json
git checkout main
```

branchが消されている場合、以下の代替手段で孤児カード数を記録:

```
node -e "
const d = require('./data/cards.json');
const slotIds = new Set(d.slots.map(s => s.id));
const orphans = d.cards.filter(c => !slotIds.has(c.slotId) && !slotIds.has(c.slot_id));
const snakeContam = d.cards.filter(c => 'slot_id' in c);
console.log(JSON.stringify({
  totalSlots: d.slots.length,
  totalCards: d.cards.length,
  orphans: orphans.length,
  snakeContaminated: snakeContam.length,
  orphanIds: orphans.map(c => c.id),
  snakeFields: [...new Set(d.cards.flatMap(c => Object.keys(c).filter(k => k.includes('_'))))]
}, null, 2));
" > docs/reports/evidence-cards-before.json
```

**1-C: .bak退避**

```
copy data\cards.json data\cards.json.bak
```

.bakのSHA-256も記録する。

---

## 手順2: Cloud PUT /cards のcamelCase受理（ai-family-foundation）

`functions/api/prompt-vault/cards/index.js` の `onRequestPut` を修正する。

現行: L35-43でslots/cardsのフィールド名がsnake_case固定。

修正: camelCase入力をD1のsnake_caseカラムに変換するdenormalize関数を追加:

```javascript
function denormalizeSlot(s) {
  return {
    id: s.id,
    name: s.name,
    slot_order: s.order ?? s.slot_order ?? 0,
    use_as_folder: s.useAsFolder ?? s.use_as_folder ? 1 : 0,
    use_in_filename: s.useInFilename ?? s.use_in_filename ? 1 : 0,
    updated_at: s.updated_at,
  };
}

function denormalizeCard(c) {
  return {
    id: c.id,
    slot_id: c.slotId ?? c.slot_id,
    name: c.name,
    positive: c.positive ?? '',
    negative: c.negative ?? '',
    parent_id: c.parentId ?? c.parent_id ?? null,
    updated_at: c.updated_at,
  };
}
```

`onRequestPut` のbind部分を書き換える:

```javascript
export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { slots = [], cards = [] } = body;
    const now = new Date().toISOString();

    const stmts = [
      env.DB.prepare('DELETE FROM pv_cards'),
      env.DB.prepare('DELETE FROM pv_slots'),
      ...slots.map(s => {
        const d = denormalizeSlot(s);
        return env.DB.prepare(
          'INSERT INTO pv_slots (id, name, slot_order, use_as_folder, use_in_filename, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(d.id, d.name, d.slot_order, d.use_as_folder, d.use_in_filename, d.updated_at || now);
      }),
      ...cards.map(c => {
        const d = denormalizeCard(c);
        return env.DB.prepare(
          'INSERT INTO pv_cards (id, slot_id, name, positive, negative, parent_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(d.id, d.slot_id, d.name, d.positive, d.negative, d.parent_id, d.updated_at || now);
      }),
    ];
    await env.DB.batch(stmts);
    return Response.json({ ok: true, slots: slots.length, cards: cards.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

これによりCloud PUT /cardsはcamelCase（canonical）とsnake_case（legacy）の**両方を受理**する。GETはnormalize経由で常にcamelCaseを返すので、round-tripの意味一致が成立する。

コミット: `fix(#3): Cloud PUT /cards accepts camelCase input via denormalize`

---

## 手順3: pv-sync.mjs のsnake_case変換撤去（ai-family-foundation）

`scripts/pv-sync.mjs` L202-221の正規化ブロックを、camelCase出力に書き換える:

```javascript
  // Normalize to canonical format (camelCase) — 裁定A
  const merged = {
    version: cloudData.version ?? franData.version ?? 1,
    slots: [...slotMap.values()].map(s => ({
      id: s.id,
      name: s.name,
      order: s.order ?? s.slot_order ?? 0,
      useAsFolder: !!(s.useAsFolder ?? s.use_as_folder),
      useInFilename: !!(s.useInFilename ?? s.use_in_filename),
      updated_at: s.updated_at || now,
    })),
    cards: [...cardMap.values()].map(c => ({
      id: c.id,
      slotId: c.slotId ?? c.slot_id,
      name: c.name,
      positive: c.positive ?? '',
      negative: c.negative ?? '',
      parentId: c.parentId ?? c.parent_id ?? null,
      updated_at: c.updated_at || now,
    })),
  };
```

`?? s.slot_order` / `?? c.slot_id` 等のフォールバックは、Cloud D1から読み出したデータ（snake_case）との互換性のため残す。ただし出力は**常にcamelCase**。

コメントを `// Normalize to cloud format (snake_case)` から `// Normalize to canonical format (camelCase) — 裁定A` に変更すること。

コミット: `fix(#3): pv-sync.mjs outputs camelCase per canonical schema ruling`

---

## 手順4: Fran cards.json 既存38件の正常化（prompt-vault-dev）

手順1のevidence・退避が完了していることを前提とする。

**4-A: 正常化スクリプトの作成と実行**

以下のスクリプトを `scripts/normalize-cards.mjs` として作成し実行する:

```javascript
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const VAULT_ROOT = process.env.VAULT_ROOT || process.env.PV_VAULT_ROOT;
if (!VAULT_ROOT) { console.error('VAULT_ROOT not set'); process.exit(1); }

const cardsPath = join(VAULT_ROOT, 'cards.json');
if (!existsSync(cardsPath)) { console.error('cards.json not found'); process.exit(1); }

const raw = readFileSync(cardsPath, 'utf8');
const data = JSON.parse(raw);

const slotIds = new Set(data.slots.map(s => s.id));

let fixed = 0;
for (const s of data.slots) {
  // snake_case → camelCase
  if ('slot_order' in s) { s.order = s.order ?? s.slot_order; delete s.slot_order; fixed++; }
  if ('use_as_folder' in s) { s.useAsFolder = s.useAsFolder ?? !!s.use_as_folder; delete s.use_as_folder; fixed++; }
  if ('use_in_filename' in s) { s.useInFilename = s.useInFilename ?? !!s.use_in_filename; delete s.use_in_filename; fixed++; }
}

for (const c of data.cards) {
  if ('slot_id' in c) { c.slotId = c.slotId ?? c.slot_id; delete c.slot_id; fixed++; }
  if ('parent_id' in c) { c.parentId = c.parentId ?? c.parent_id; delete c.parent_id; fixed++; }
}

// 孤児カード除去（slotIdが存在しないslotを参照）
const orphans = data.cards.filter(c => !slotIds.has(c.slotId));
if (orphans.length > 0) {
  console.log(`Removing ${orphans.length} orphan cards: ${orphans.map(c => c.id).join(', ')}`);
  data.cards = data.cards.filter(c => slotIds.has(c.slotId));
  fixed += orphans.length;
}

console.log(`Fixed ${fixed} issues`);

// 書き出し（#34未修正のため原地上書き。手順1で.bak退避済み）
writeFileSync(cardsPath, JSON.stringify(data, null, 2));

// SHA-256
const newHash = createHash('sha256').update(readFileSync(cardsPath)).digest('hex');
console.log(`New SHA-256: ${newHash}`);
console.log('Done. Server restart required to reload.');
```

実行:
```
node scripts/normalize-cards.mjs
```

**4-B: 再読込検証**

Franサーバーを再起動し、`GET /api/cards` が返すデータにsnake_caseフィールドが含まれないことを確認する:

```
curl http://localhost:8789/api/cards | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
const bad=j.cards.filter(c=>'slot_id' in c || 'parent_id' in c);
const badS=j.slots.filter(s=>'slot_order' in s || 'use_as_folder' in s || 'use_in_filename' in s);
console.log('snake_case cards:', bad.length, 'snake_case slots:', badS.length);
const slotIds=new Set(j.slots.map(s=>s.id));
const orphans=j.cards.filter(c=>!slotIds.has(c.slotId));
console.log('orphan cards:', orphans.length);
"
```

期待結果: `snake_case cards: 0 snake_case slots: 0 orphan cards: 0`

**4-C: 修復後evidence**

手順1と同じ方法で修復後evidenceを取得:
```
certutil -hashfile data\cards.json SHA256
```

結果をdocs/reports/に記録する（evidence-cards-after）。

コミット（正常化スクリプト追加）: `fix(#36): add cards.json normalization script and execute camelCase cleanup`

---

## 手順5: round-trip検証（Cloud）

Cloud GETで取得したcardsをそのままCloud PUTに送り、再度GETして意味一致を確認する:

```
# GET
curl -s -H "Authorization: Bearer 11233966" -H "User-Agent: ai-family-sync/1.0" \
  "https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault/cards" > /tmp/cards-get1.json

# PUT（GETの結果をそのまま）
curl -s -X PUT -H "Authorization: Bearer 11233966" -H "User-Agent: ai-family-sync/1.0" \
  -H "Content-Type: application/json" \
  -d @/tmp/cards-get1.json \
  "https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault/cards"

# GET again
curl -s -H "Authorization: Bearer 11233966" -H "User-Agent: ai-family-sync/1.0" \
  "https://ai-family-foundation.misfortunemate.workers.dev/api/prompt-vault/cards" > /tmp/cards-get2.json

# 比較（updated_at以外が一致すること）
node -e "
const a=JSON.parse(require('fs').readFileSync('/tmp/cards-get1.json','utf8'));
const b=JSON.parse(require('fs').readFileSync('/tmp/cards-get2.json','utf8'));
const strip = arr => arr.map(x => { const {updated_at, ...rest} = x; return rest; });
const eq = JSON.stringify(strip(a.slots)) === JSON.stringify(strip(b.slots))
  && JSON.stringify(strip(a.cards)) === JSON.stringify(strip(b.cards));
console.log('round-trip match:', eq);
"
```

期待結果: `round-trip match: true`

この検証にはWorkerデプロイが必要。手順2完了後に発注者へデプロイ依頼。

---

## コミット指針

1. `fix(#3): Cloud PUT /cards accepts camelCase input via denormalize` （foundation）
2. `fix(#3): pv-sync.mjs outputs camelCase per canonical schema ruling` （foundation）
3. `fix(#36): add cards.json normalization script and execute camelCase cleanup` （pv-dev）

## 禁止事項

- D1 migration追加・ALTER TABLE
- presetsスキーマの変更（#15は②の範囲）
- sync仕様のLWW方向・tombstone設計の変更
- pv_cards_sync / pv_presets_sync の実行（方針書§3により停止中）
- 正常化スクリプトによる.bak退避なしのcards.json書き換え

## 完了条件

1. Cloud PUT /cardsがcamelCase入力を受理すること
2. pv-sync.mjsの出力がcamelCase（canonical）であること
3. Fran cards.jsonにsnake_caseフィールドが0件であること
4. Fran cards.jsonに孤児カードが0件であること
5. 修復前evidence（SHA-256 + doctor/代替スクリプト出力）が docs/reports/ に記録されていること
6. .bakファイルが data/ に存在し、修復前のSHA-256と一致すること
7. 修復後evidence（SHA-256 + noncanonical 0件確認）が docs/reports/ に記録されていること
8. round-trip検証が合格すること（Workerデプロイ後）
9. 各リポジトリのinspect合格

## 報告基準

報告は prompt-vault-dev の docs/reports/ に置く。

1. 手順1〜5の実施結果
2. 完了条件の各項に対する充足状況
3. evidence: 修復前SHA-256、修復前snake_case/orphan件数、修復後SHA-256、修復後0件確認
4. .bakのSHA-256
5. round-trip検証結果（Workerデプロイ前の場合はNOT RUN）
6. inspect結果
7. Workerデプロイ要否
