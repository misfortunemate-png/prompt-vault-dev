# prompt-vault 親子ランダム修正＋アルバム表示速度改善 指示書

文書種別: 権威文書

作成日: 2026-09-04 ／ PM: クリーデ

## 背景

発注者の実使用中に発見された2件。

### バグ3: 親スロットのランダムで子が出ない

`buildSingleTask()` のランダム選択（`slotRandomMap[slot.id]`）がスロット内の全カード（親＋子）から1枚選ぶため、親カード（例: "東方"）だけが選ばれて子カード（例: "博麗霊夢"）が出力されないことがある。ランダムで親が選ばれた場合、子も必ず1枚ランダムに付随すべき。

原因: `randomPicks[slotId]` が設定されると、その後の `childRes` 解決ロジックが `if (randomPicks[slotId]) return;` でスキップされる。

### バグ4: クラウドのアルバムで新着画像の読み込みが遅い

クラウド生成画像は `thumb_ok=0`（サムネイル未生成）のため、アルバムグリッドの各セルがフル画像（~1.5MB）をfetch→AES-GCM復号している。さらにスクロールで見えなくなるとblobUrlが revokeObjectURL で破棄され、戻ると再fetch が走る。

## 作業範囲

prompt-vault-dev のみ。

## 修正内容

### 修正3: 親子ランダム選択の修正（GenerateScreen.jsx）

`buildSingleTask()` 内のランダム選択ロジックを以下に変更。

**変更前:**
```javascript
if (slotRandomMap[slot.id]) {
    const slotCards = allCards.filter(c => c.slotId === slot.id);
    if (slotCards.length > 0) {
        randomPicks[slot.id] = slotCards[Math.floor(Math.random() * slotCards.length)];
        effectiveMap[slot.id] = randomPicks[slot.id].id;
    }
}
```

**変更後:**
```javascript
if (slotRandomMap[slot.id]) {
    // ルートカード（親がないカード）のみから選ぶ
    const rootCards = allCards.filter(c => c.slotId === slot.id && !c.parentId);
    if (rootCards.length > 0) {
        const parent = rootCards[Math.floor(Math.random() * rootCards.length)];
        const children = allCards.filter(c => c.parentId === parent.id);
        if (children.length > 0) {
            // 子があれば子をランダムに1枚選び、randomPicksには子を格納
            randomPicks[slot.id] = children[Math.floor(Math.random() * children.length)];
        } else {
            // 子がなければ親そのまま
            randomPicks[slot.id] = parent;
        }
        effectiveMap[slot.id] = randomPicks[slot.id].id;
    }
}
```

**プロンプト合成部分も修正:** ランダムで子カードが選ばれた場合、親のプロンプトも先に結合する必要がある。

```javascript
// 変更前
const rp = randomPicks[slot.id];
if (rp) {
    if (rp.positive) pos = pos ? pos + ', ' + rp.positive : rp.positive;
    if (rp.negative) neg = neg ? neg + ', ' + rp.negative : rp.negative;
    return;
}

// 変更後
const rp = randomPicks[slot.id];
if (rp) {
    // 子の場合、先に親のプロンプトを追加
    if (rp.parentId) {
        const parent = allCards.find(c => c.id === rp.parentId);
        if (parent?.positive) pos = pos ? pos + ', ' + parent.positive : parent.positive;
        if (parent?.negative) neg = neg ? neg + ', ' + parent.negative : parent.negative;
    }
    if (rp.positive) pos = pos ? pos + ', ' + rp.positive : rp.positive;
    if (rp.negative) neg = neg ? neg + ', ' + rp.negative : rp.negative;
    return;
}
```

**label 生成の getName も修正:** 子が選ばれた場合、表示名は「親×子」ではなく子の名前でよい（現状のまま `randomPicks[slot.id].name` を返すので変更不要）。

**folderSegments は修正不要:** 既存ロジックが `finalCard.parentId` をチェックして親名＋子名を push している。randomPicks に子カードが入ればそのまま正しく動く。

### 修正4: アルバム blobUrl キャッシュ（AlbumScreen.jsx）

#### 4a: モジュールレベルの blobUrl キャッシュ

コンポーネント外に `Map<hash, blobUrl>` を定義し、一度復号した画像のblobUrlを保持する。ThumbCell がアンマウントされても破棄しない。

```javascript
// AlbumScreen.jsx 冒頭（コンポーネント外）
const thumbCache = new Map();  // hash → blobUrl
```

ThumbCell 内:
```javascript
useEffect(() => {
    if (!isCloud) return;
    // キャッシュにあればそのまま使う
    if (thumbCache.has(image.hash)) {
        setBlobUrl(thumbCache.get(image.hash));
        return;
    }
    // IntersectionObserver で読み込み
    // ...既存のfetch→decrypt処理...
    // blobUrl生成後にキャッシュに保存
    thumbCache.set(image.hash, url);
    setBlobUrl(url);
    // cleanup: revokeObjectURL しない（キャッシュが保持）
}, [...]);

// cleanup で revokeObjectURL を呼ばない（キャッシュに残す）
```

#### 4b: 同時読み込み数の制限

モジュールレベルのセマフォ（カウンター）で並行fetch数を制限する。ブラウザの同一ドメイン同時接続数（6本程度）に合わせ、復号の並行数を4に制限する。

```javascript
// AlbumScreen.jsx 冒頭
let activeDecrypts = 0;
const MAX_CONCURRENT = 4;
const waitQueue = [];

function acquireSlot() {
    return new Promise(resolve => {
        if (activeDecrypts < MAX_CONCURRENT) { activeDecrypts++; resolve(); }
        else waitQueue.push(resolve);
    });
}
function releaseSlot() {
    activeDecrypts--;
    if (waitQueue.length > 0) { activeDecrypts++; waitQueue.shift()(); }
}
```

ThumbCell の fetch 部分:
```javascript
await acquireSlot();
try {
    const r = await fetch(...);
    // ...decrypt...
} finally {
    releaseSlot();
}
```

## テスト・検収基準

| # | テスト | 合格条件 |
|---|---|---|
| T-1 | 「キャラクター」スロットのランダムを有効→10回生成 | 親（作品名）のみの出力がゼロ。常に子（キャラ名）が付随すること |
| T-2 | ランダムで子なしカードが選ばれた場合 | エラーなく正常に出力されること |
| T-3 | アルバムをスクロールダウン→スクロールアップ | 一度読み込んだ画像が瞬時に再表示されること（再fetchなし） |
| T-4 | アルバムを開いた直後の表示 | プレースホルダーが出てから画像が順次表示されること（全画像がブロックしない） |
| T-5 | regression: ランダムOFF（手動選択）の生成が従来通り動くこと |

## 禁止事項

- handleAddToQueue（キュー生成）のランダム処理は本修正と同じ buildSingleTask を使うため、キュー側は変更不要
- サムネイル生成の実装は本指示の範囲外（別工事として検討）

## 報告先

docs/reports/ に報告書を置く。
