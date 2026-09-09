# 契約統一とschema汚染除去 evidence記録
対応Issue: ai-family-foundation #3 / prompt-vault-dev #36
実施日: 2026-09-10

## 手順1: 修復前evidence

### 1-A: 修復前 SHA-256
- `data/cards.json`: `d43e6beeb8feee1c8cabb2ded20178028344d821dd872d7cf51e9ab85fc0068f`

### 1-B: doctor出力（代替スクリプト）
- snakeContaminatedCards: 38（全カード、slot_id + parent_id）
- snakeSlots: 8（全スロット、slot_order + use_as_folder + use_in_filename）
- orphans: 0
- 詳細: `docs/reports/evidence-cards-before.json`（doctor branch出力）
- 詳細: `docs/reports/evidence-cards-before-alt.json`（代替スクリプト出力）

### 1-C: .bak退避
- `data/cards.json.bak` SHA-256: `d43e6beeb8feee1c8cabb2ded20178028344d821dd872d7cf51e9ab85fc0068f`（一致確認）

## 手順4: 修復後evidence

### 4-A: normalize-cards.mjs 実行結果
- Fixed 100 issues（slots 8×3 + cards 38×2 = 100フィールド修正）
- orphan cards removed: 0

### 4-B: 修復後検証
- snake_case cards: 0
- snake_case slots: 0
- orphan cards: 0
- total slots: 8 / total cards: 38（件数変化なし）

### 4-C: 修復後 SHA-256
- `data/cards.json`: `45a2625aee003a1c1de72c226e88cae92f7e88b771fee385fc28aba9ed7b2cf1`

## 完了条件充足状況

| # | 条件 | 状態 |
|---|---|---|
| 1 | Cloud PUT /cards がcamelCase入力を受理 | ✅ denormalize関数追加（Workerデプロイ後確認） |
| 2 | pv-sync.mjs 出力がcamelCase | ✅ 修正済み |
| 3 | Fran cards.json snake_caseフィールド 0件 | ✅ 確認済み |
| 4 | Fran cards.json 孤児カード 0件 | ✅ 確認済み |
| 5 | 修復前evidence記録済み | ✅ このファイル参照 |
| 6 | .bakファイル存在・SHA-256一致 | ✅ d43e6b… |
| 7 | 修復後evidence記録済み | ✅ このファイル参照 |
| 8 | round-trip検証 | NOT RUN（Workerデプロイ後） |
| 9 | inspect合格 | 確認中 |

## 手順5: round-trip検証
Workerデプロイが必要。デプロイ後に実施予定。
