# ⑤ 永続化・migrationの固め 作業指示書
文書種別: 権威文書

作成日: 2026-09-12 ／ PM: クリーデ
上位文書: ai-family-ops/docs/20260910_pv-review2_remediation-policy_v1.0.md §2-⑤、§1-3

対象Issue:
- prompt-vault-dev #34（JSON原地上書き）
- prompt-vault-dev #35（migration基盤・残項目のみ）

前提: #33（空catch ALTER）はクローズ済み、foundation #30（D1 migration履歴分岐）もクローズ済み。

## §0 スコープ原則（転記）

> 新たな機能や基盤改変は行わない。

§1-3の三点のみ実施する。互換deploy方式の新設計は行わない。

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／仕様どおりだと問題が生じる／技術的に実現困難
2. **着工前**: `git pull` → `npm run inspect`

## 作業範囲

- **何を**: (a) atomic保存、(b) M2→M3 migration完了marker、(c) remote D1棚卸し再実行
- **どこで**: prompt-vault-dev（(a)(b)）、ai-family-foundation（(c) d1-doctor修正のみ）
- **触らないもの**: D1 migration追加、Cloud Worker、sync仕様、フロントUI

---

## 手順1: 正本JSONのatomic保存（#34）

### 問題

`writeCardsData`/`writePresetsData`/settings書込みが`writeFileSync(path, data)`で直接上書き。書込み途中のプロセスクラッシュ・電源断でJSONが壊れる。

### 修正

`server.js` に atomic書込み共通関数を追加:

```javascript
import { writeFileSync, renameSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

/**
 * temp書込み → 直前版1世代退避(.bak) → atomic rename
 */
function atomicWriteJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';

  // 1. temp fileに完全書込み
  writeFileSync(tmpPath, json);

  // 2. 既存ファイルを.bakに退避（1世代のみ）
  if (existsSync(filePath)) {
    try { copyFileSync(filePath, bakPath); } catch {}
  }

  // 3. temp → 正本にatomic rename
  renameSync(tmpPath, filePath);
}
```

既存の3関数を書き換え:

```javascript
function writeCardsData(data) {
  atomicWriteJson(CARDS_PATH, data);
}

function writePresetsData(data) {
  atomicWriteJson(PRESETS_DATA_PATH, data);
}
```

settings書込み（L254, L815）も同様に`atomicWriteJson`を使う:

```javascript
// L254（PUT /settings）
api.put('/settings', (req, res) => {
  atomicWriteJson(SETTINGS_PATH, req.body);
  res.json({ ok: true });
});

// L815（debug/reset）
atomicWriteJson(SETTINGS_PATH, DEFAULT_SETTINGS);
```

### 備考

- `renameSync`はPOSIX/Windowsとも同一ボリューム内ではatomic。tmpPathは同ディレクトリなので問題なし
- `.bak`は1世代のみ。古い.bakは上書きされる
- `.tmp`はrename成功で消える。rename前にクラッシュした場合は次回起動時に`.tmp`が残るが、正本は無傷

コミット: `fix(#34): atomic JSON write with temp+rename and 1-generation backup`

---

## 手順2: M2→M3 migration完了marker（#35残項目）

### 問題

`runMigration()`（L132-184）は通常起動パスから毎回呼ばれる。完了markerがないため、cards.jsonが存在しない＋presets.jsonが存在する条件で毎回判定する。途中失敗時に半端なcards.jsonが生成されると、次回起動で「完了済み」と誤認する。

### 修正

**A: 完了markerの導入**

migration完了後にmarkerファイルを作成する:

```javascript
function runMigration(vaultRoot) {
  const m2Path = join(vaultRoot, 'presets.json');
  const bakPath = join(vaultRoot, 'presets.json.bak');
  const markerPath = join(vaultRoot, '.m3-migrated');

  // 完了marker存在 → skip
  if (existsSync(markerPath)) return;

  // M2ソース不在 or M3既存 → skip（既存ロジック維持）
  if (!existsSync(m2Path) || existsSync(CARDS_PATH)) return;

  console.log('[Migration] M2 presets.json → M3 cards.json を開始');
  // ... 既存の変換ロジック ...

  // atomic書込みを使用（手順1で導入済み）
  atomicWriteJson(CARDS_PATH, cards);
  if (!existsSync(PRESETS_DATA_PATH)) atomicWriteJson(PRESETS_DATA_PATH, { version: 1, presets: [] });
  renameSync(m2Path, bakPath);

  // 完了marker作成
  writeFileSync(markerPath, JSON.stringify({
    migrated_at: new Date().toISOString(),
    slots: cards.slots.length,
    cards: cards.cards.length,
  }));

  console.log(`[Migration] 完了: スロット${cards.slots.length}件, カード${cards.cards.length}件`);
}
```

**B: 途中失敗時の旧状態維持**

cards.json書込みにatomicWriteJsonを使うことで、書込み失敗時に正本が壊れない（手順1で達成済み）。markerはcards.json/presets.json/bakのすべてが成功した後にのみ作成するため、途中失敗→再起動で再実行が可能。

コミット: `fix(#35): add M2→M3 migration completion marker`

---

## 手順3: remote D1棚卸し再実行（#35残項目）

### 問題

`d1-doctor.mjs`のspawnSyncがWindows上で`.cmd`ファイルのEINVALを起こす。L231の`spawnSync(process.execPath, directArgs, ...)`が失敗し、L241-262のcmd.exe fallbackも`EINVAL`で失敗している。

### 修正

**A: d1-doctor.mjs のWindows互換修正**（ai-family-foundation、ブランチ`chatgpt/review-doctor-20260909`）

L231のdirect launch に `shell: true` を追加:

```javascript
let result = spawnSync(process.execPath, directArgs, {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: timeoutMs,
  maxBuffer: 10 * 1024 * 1024,
  windowsHide: true,
  shell: true,  // Windows .cmd互換
});
```

`shell: true`によりcmd.exeが内部で呼ばれ、.cmd/.bat/.exeの解決がOS側で行われる。EINVALの根本原因（spawnSyncが.cmdファイルを直接実行できない）を解消する。

L241-262のfallbackブロックは残しても害はないが、direct launchで成功するならfallbackには到達しないので、削除してもよい（PG判断に委ねる）。

**B: 再実行と結果記録**

修正後にremote D1棚卸しを実行する:

```
cd D:\AI\github\ai-family-foundation
git checkout chatgpt/review-doctor-20260909
npm run doctor:d1:json -- --remote > docs/reports/evidence-d1-remote.json
```

結果がCOMPATIBLEなら記録して完了。REPAIR_REQUIREDなら差分の内容を報告に含める（repair SQLの実行は本指示の範囲外）。

実行後にmainに戻す:

```
git checkout main
```

**注意**: d1-doctor.mjsの修正はPRブランチ上で行う。mainには直接pushしない。修正をブランチにコミット→pushすればPR #31が更新される。

コミット（ブランチ上）: `fix: add shell:true to spawnSync for Windows .cmd compat`

---

## コミット指針

### prompt-vault-dev（main）
1. `fix(#34): atomic JSON write with temp+rename and 1-generation backup`
2. `fix(#35): add M2→M3 migration completion marker`

### ai-family-foundation（ブランチ `chatgpt/review-doctor-20260909`）
3. `fix: add shell:true to spawnSync for Windows .cmd compat`（PR #31更新）

---

## 禁止事項

- D1 migration追加
- Cloud Workerの変更
- 互換deploy方式の新設計
- M2→M3 migrationロジックの機能変更（markerの追加のみ）

## テスト

- PG自己完結分:
  - prompt-vault-dev: `npm run inspect`（既存赤以外に新規赤なし）
  - prompt-vault-dev: `npm run build` 成功
  - 手順1: cards.jsonにカード追加→CARDS_PATH.bakが生成されること。.bakの内容が追加前のものであること
  - 手順1: CARDS_PATH.tmpが残っていないこと（rename成功）
  - 手順2: `.m3-migrated`が存在しない環境でpresets.json→cards.json変換が動作すること（現環境では既にcards.jsonが存在するのでskipされる。markerファイルの存在でもskipされることをif条件で確認）
  - 手順3: `npm run doctor:d1:json -- --remote` がEINVALなしで完了すること
- NOT RUN:
  - 書込み途中のプロセスkillによるatomic性の実証
  - M2→M3 migration途中失敗からの再実行（M2ソースがない現環境では再現不可）

## 完了条件

1. `writeCardsData`/`writePresetsData`/settings書込みが全て`atomicWriteJson`を使用していること
2. cards.json書込み後に`.bak`が生成されること
3. `runMigration`に完了marker（`.m3-migrated`）チェックが含まれること
4. remote D1棚卸し結果（JSON）が`docs/reports/evidence-d1-remote.json`に記録されていること
5. 各inspect合格

## 報告基準

報告は prompt-vault-dev の docs/reports/ に置く。

1. 手順1〜3の実施結果
2. 完了条件の充足状況
3. 手順1: .bak生成の確認結果
4. 手順3: remote D1棚卸しの判定結果（COMPATIBLE/REPAIR_REQUIRED）と主要所見
5. inspect結果
6. NOT RUN項目
