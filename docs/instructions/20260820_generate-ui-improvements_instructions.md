# prompt-vault 生成画面UI改善 作業指示書
文書種別: 権威文書

作成日: 2026-08-20 ／ PM: クリーデ（技術顧問席・Fable） ／ 本書一枚で完結

## PG運用規律（定型）

1. 停止条件: 仕様にない判断が必要／技術的に実現困難／難航。報告して指示を待つ
2. 発注者指示による仕様外修正: 実施可。報告時に明記
3. 着工前: `git pull`

## 作業範囲

5件の改善を実施する。すべて生成画面（GenerateScreen）周りのUI/UX改善。

---

### 改善1: トーストの位置と表示時間

**対象:** `src/components/Toast.jsx`

**現状の問題:**
- 位置が `bottom: 62px` でボタンに被る
- 非エラーの自動消失が10秒（長すぎる）

**変更:**
1. 位置を画面最上部に変更: `bottom: 62px` → `top: 12px`（`transform`もそのまま）
2. 自動消失時間を変更:
   - error: 自動消失しない（現状通り、手動×で閉じる）
   - success/info: 2秒で消える（`AUTO_DISMISS_MS` を type別に分岐。success/info = 2000ms）
3. フェード開始もそれに合わせて調整（FADE_MS = 300 はそのまま、開始タイミングを 2000 - 300 = 1700ms に）

---

### 改善2: プロンプト記憶とクリア

**対象:** `src/screens/GenerateScreen.jsx`

**現状の問題:**
- 画面を開くたびにプロンプトを入れ直す必要がある

**変更:**
1. 生成成功時（単発・キュー両方）に、現在のプロンプト設定をlocalStorageに保存する
   - キー: `pv3-last-prompt`
   - 値: `{ positive, negative, model, resolution, steps, scale, sampler }` のJSON
   - seed, selectedPresetId, selectedCardMap, localSlotOrder, localSlotPropsは保存しない（セッション固有のため）
2. GenerateScreen初期化時（useStateの初期値 or useEffectの初回）にlocalStorageから復元する
   - 復元対象: editedPositive, editedNegative, model, resolution, steps, scale, sampler
   - 値がなければ現在のデフォルト値を使用
3. クリアボタンを追加: プロンプト入力欄の近くに「クリア」ボタンを配置。押すとlocalStorageを消去し、全フィールドをデフォルト値にリセット

---

### 改善3: スロットの有効/無効・ランダムチェックボックス

**対象:** `src/screens/GenerateScreen.jsx`

**現状のUI（1スロット分）:**
```
[▲▼] スロット名 [F] [N] [×]
[カード選択ドロップダウン          ]
```

**変更後のUI:**
```
[▲▼] スロット名 [有効] [ランダム] [F] [N] [×]
[カード選択ドロップダウン          ]  ← ランダムON時はグレーアウト
```

**有効/無効チェックボックス:**
- 状態管理: `slotEnabledMap` （`{ [slotId]: boolean }`、デフォルトtrue）
- チェックを外すとそのスロットのカードがプロンプト合成に含まれない
- UI上: チェックなしの場合、スロット全体を半透明（opacity: 0.4）にする
- `buildSingleTask()`, `buildCartesianTasks()`, 単発生成の3箇所で、`slotEnabledMap[slot.id] === false` のスロットをスキップする

**ランダムチェックボックス:**
- 状態管理: `slotRandomMap` （`{ [slotId]: boolean }`、デフォルトfalse）
- チェックを入れると、そのスロットの全カード（ルート＋子、親子関係を無視してフラット）から1枚をランダム選択する
- カード選択ドロップダウンはランダムON時に `disabled` にする（グレーアウト）
- 生成時のランダム選択ロジック:
  ```javascript
  const allSlotCards = allCards.filter(c => c.slotId === slot.id);
  const picked = allSlotCards[Math.floor(Math.random() * allSlotCards.length)];
  ```
- 直積展開（cartesian）時: ランダムスロットは展開対象外（1回の生成ごとにランダム1枚）

---

### 改善4: フォルダパスへの親カード名反映

**対象:** `src/screens/GenerateScreen.jsx` — `buildSingleTask()`, `buildCartesianTasks()`, 単発生成のfolderSegments構築

**現状の問題:**
- F付きスロットでカードが親子構造を持つ場合、フォルダパスに子カード名のみ出力される
- 期待: 親カード名/子カード名 の階層パスを出力

**変更:**
folderSegmentsの構築ロジックで、選ばれたカードにparentIdがある場合、親の名前を先に挿入する:

```javascript
// 現在:
const folderSegments = sortedSlots.filter(s => s.useAsFolder).map(s => getName(s.id)).filter(Boolean);

// 変更後:
const folderSegments = [];
sortedSlots.filter(s => s.useAsFolder).forEach(s => {
  const cardId = /* そのスロットで最終的に選ばれたカードのID */;
  const card = allCards.find(c => c.id === cardId);
  if (!card) return;
  if (card.parentId) {
    const parent = allCards.find(c => c.id === card.parentId);
    if (parent?.name) folderSegments.push(parent.name);
  }
  if (card.name) folderSegments.push(card.name);
});
```

- 親がない（ルートカード）場合: `[カード名]` → 1階層
- 親がある場合: `[親名, カード名]` → 2階層
- F排他制御は変更しない（Fは1スロットのみ）
- `buildSingleTask()`, `buildCartesianTasks()`, 単発生成の3箇所すべてに適用

---

### 改善5: プロンプト入力欄の拡大

**対象:** `src/screens/GenerateScreen.jsx` — プロンプト編集エリア（showPromptEdit表示時）

**現状の問題:**
- 入力欄を開いても小さく、仮想キーボードに隠れる

**変更:**
- `showPromptEdit` が true のとき、プロンプト編集エリアの高さを画面の約50%に確保する
- textareaのrows属性を増やすか、minHeightをvh単位で設定する
- 入力欄を開いたとき、スクロール位置を入力欄の先頭に合わせる（`scrollIntoView`）
- 仮想キーボード対策: `position: sticky` + `bottom: 0` は使わず、単純に十分な高さを確保し、ブラウザの自動スクロールに委ねる

具体的には:
```javascript
// 正プロンプトtextarea
<textarea
  rows={8}  // 現在の値から増やす（現在値を確認して調整）
  style={{ ...fieldStyle, resize: 'vertical', minHeight: '40vh' }}
  ...
/>
```

---

## 禁止事項

- F排他制御のロジック（handleToggleSlotPropのuseAsFolder分岐）を変更しない
- npm依存を追加しない
- カード・プリセットのデータモデル（サーバー側）を変更しない

## テスト

| # | 対象 | 合格条件 |
|---|---|---|
| 1 | トースト位置 | 画面最上部に表示されること |
| 2 | トースト消失 | success/infoは2秒で消え、errorは手動閉じまで残ること |
| 3 | プロンプト記憶 | 生成後、画面を離れて戻ったとき前回のプロンプト設定が復元されること |
| 4 | クリアボタン | 押すと全フィールドがデフォルトに戻ること |
| 5 | 有効/無効 | 無効スロットがプロンプト合成から除外されること |
| 6 | ランダム | ランダムONのスロットで生成するたびに異なるカードが選ばれること |
| 7 | フォルダ親子 | 親子カードのF付きスロットで保存先が`親名/子名/`になること |
| 8 | フォルダ単体 | 親なしカードのF付きスロットで保存先が`カード名/`になること（従来通り） |
| 9 | 入力欄拡大 | プロンプト入力欄を開いたとき画面の約半分を占めること |

## 完了条件

- 5件すべてが動作すること
- ビルド・サーバー再起動・コミット・プッシュ実施済み
- _STATUS.md更新
