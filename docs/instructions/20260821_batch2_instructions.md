# prompt-vault バグ修正・改善バッチ2 作業指示書
文書種別: 権威文書

作成日: 2026-08-21 ／ PM: クリーデ（技術顧問席・Fable） ／ 本書一枚で完結

## PG運用規律（定型）

1. 停止条件: 仕様にない判断が必要／技術的に実現困難／難航。報告して指示を待つ
2. 発注者指示による仕様外修正: 実施可。報告時に明記
3. 着工前: `git pull`

## 作業一覧（5件）

| # | 内容 | 対象 |
|---|---|---|
| 6 | NAI v4.5キャラプロンプト読み取り | server/png-meta.js |
| 7 | カード選択の永続化 | src/screens/GenerateScreen.jsx |
| 8 | 保存後にサムネイルから画像が消える | 調査→修正 |
| 9 | ファントムカード（空カードが存在扱い） | 調査→修正 |
| 10 | フッタータブ再押下でルート状態に戻る | src/App.jsx, src/components/Footer.jsx, 各Screen |

---

### #6: NAI v4.5キャラクタープロンプト読み取り

**対象:** `server/png-meta.js` — `parseNovelAiChunk`関数

**現状:** `Comment` JSONから `prompt`（基本プロンプト）と `uc`（ネガティブ）のみ読んでいる。NAI v4/4.5では `v4_prompt.caption.char_captions` にキャラクター固有プロンプトが格納されるが、これを読んでいない。

**変更:** `parseNovelAiChunk` の `Comment` パース部分に以下を追加:

```javascript
// NAI v4/4.5: キャラクタープロンプトの読み取り
if (parsed.v4_prompt?.caption?.char_captions?.length) {
  const charParts = parsed.v4_prompt.caption.char_captions
    .map(c => c.char_caption)
    .filter(Boolean);
  if (charParts.length) {
    // 基本プロンプト + キャラプロンプトを結合
    const base = parsed.v4_prompt.caption.base_caption || result.prompt || '';
    result.prompt = [base, ...charParts].filter(Boolean).join(', ');
  }
}
// v4ネガティブも同様
if (parsed.v4_negative_prompt?.caption?.char_captions?.length) {
  const charNegParts = parsed.v4_negative_prompt.caption.char_captions
    .map(c => c.char_caption)
    .filter(Boolean);
  if (charNegParts.length) {
    const baseNeg = parsed.v4_negative_prompt.caption.base_caption || result.negative || '';
    result.negative = [baseNeg, ...charNegParts].filter(Boolean).join(', ');
  }
}
```

**注意:** `v4_prompt.caption.char_captions` の各要素は `{ char_caption: string, centers: [...] }` の形式。`centers` は位置情報で、プロンプト読み取りでは不要。

**テスト:** NAI v4.5で生成した画像（キャラプロンプト付き）をスキャンし、キャラプロンプトがpromptに含まれていること。

---

### #7: カード選択の永続化

**対象:** `src/screens/GenerateScreen.jsx`

**現状:** プリセットのスロットでカードを選択しても、画面遷移やリロードで選択が消える。#2で追加したプロンプト記憶（localStorage `pv3-last-prompt`）にカード選択は含まれていない。

**変更:**
1. `selectedCardMap`（`{ [slotId]: cardId }`）をlocalStorageに保存する
   - キー: `pv3-selected-cards`
   - 保存タイミング: selectedCardMapが変更されるたび
2. GenerateScreen初期化時にlocalStorageから復元する
3. プリセットを切り替えた場合は保存値をクリアし、新プリセットのデフォルト選択にする
4. 既存のクリアボタン（#2で追加済み）押下時にこの保存値もクリアする

---

### #8: 画像保存後にサムネイルから消える

**対象:** 調査が必要。おそらく `src/screens/GenerateScreen.jsx` の結果表示と `server.js` の `/api/save` エンドポイント

**現象:** 生成結果のサムネイルが表示されている状態で画像を保存すると、そのサムネイルが消える。

**調査手順:**
1. `/api/save` のレスポンスを確認。save後にファイルが `.tmp/` から正式フォルダに移動し、旧パス（`.tmp/filename`）が無効になっていないか
2. GenerateScreenのresults state管理を確認。save成功時にresultsから削除する処理が入っていないか
3. save後のsrcパスが更新されているか

**修正方針:**
- save後もresultsに残す（消さない）
- save後のサムネイルは、保存先の正式パスに更新するか、save済みバッジを付けて`.tmp`パスのままにする（`.tmp`ファイルが残っているなら後者で十分）
- save済みの画像を再度saveしようとした場合はエラーにならないよう防ぐ

---

### #9: ファントムカード（空カードが存在扱いになる）

**対象:** 調査が必要。おそらくカード作成・削除のCRUDロジック

**現象:** カード編集画面でカードの中身（プロンプト等）が空なのに、カードが存在する扱いになっている。

**調査手順:**
1. カード作成フロー（POST /api/cards）を確認。空のカードが作成されるケースがないか
2. カード削除フロー（DELETE /api/cards/:id）を確認。削除がDB/JSONから正しく消えているか
3. フロントエンドのカード一覧取得で、空カードをフィルタしているか

**修正方針:**
- 原因に応じて:
  - 空カード作成の防止（バリデーション追加）
  - 既存の空カードのクリーンアップ
  - 一覧表示時に空カードをフィルタ
- 原因が特定できたら修正。特定困難な場合は報告で「再現手順と仮説」を記載

---

### #10: フッタータブ再押下でルート状態に戻る

**対象:** `src/App.jsx`, `src/components/Footer.jsx`, 各Screen

**現象:** アルバム画面でフォルダを深く潜っていても「アルバム」タブを再タップしても何も起きない。同じタブの再タップでルート状態に戻るべき。

**変更:**

1. **App.jsx** — タブ切替ハンドラを変更:

```javascript
// 現在:
<Footer activeTab={activeTab} onTabChange={setActiveTab} />

// 変更後:
const [resetKey, setResetKey] = useState(0);

const handleTabChange = useCallback((tab) => {
  if (tab === activeTab) {
    // 同じタブを再タップ → リセットシグナル
    setResetKey(k => k + 1);
  } else {
    setActiveTab(tab);
  }
}, [activeTab]);

<Footer activeTab={activeTab} onTabChange={handleTabChange} />
```

2. **各Screenにresetkeyを渡す:**

```jsx
mainContent = <AlbumScreen addToast={addToast} resetKey={resetKey} />;
mainContent = <GenerateScreen addToast={addToast} results={results} setResults={setResults} maxResults={maxResults} resetKey={resetKey} />;
mainContent = <TemplateScreen addToast={addToast} resetKey={resetKey} />;
```

3. **AlbumScreen** — `resetKey` 変更時にルートに戻る:

```javascript
useEffect(() => {
  if (resetKey > 0) {
    setPath(null);      // ルートフォルダに戻る
    setViewer(null);     // ビューアを閉じる
    window.scrollTo(0, 0);
  }
}, [resetKey]);
```

4. **GenerateScreen** — `resetKey` 変更時にスクロールトップ:

```javascript
useEffect(() => {
  if (resetKey > 0) {
    window.scrollTo(0, 0);
  }
}, [resetKey]);
```

5. **TemplateScreen** — `resetKey` 変更時にリスト画面に戻る:

```javascript
useEffect(() => {
  if (resetKey > 0) {
    // 編集画面にいた場合はリストに戻る（内部stateをリセット）
    setEditId(null);  // or whatever state controls the edit view
    window.scrollTo(0, 0);
  }
}, [resetKey]);
```

---

## 禁止事項

- npm依存を追加しない
- 既存のプロンプト記憶（#2: localStorage `pv3-last-prompt`）の仕組みを壊さない
- F排他制御のロジックを変更しない

## テスト

| # | 対象 | 合格条件 |
|---|---|---|
| 6 | NAIv4.5メタデータ | キャラプロンプト付き画像のスキャンで、promptにキャラ部分が含まれること |
| 7 | カード選択保存 | 画面遷移→復帰後にカード選択が維持されること。プリセット変更でリセットされること |
| 8 | サムネ消失 | 画像保存後もサムネイルが表示され続けること |
| 9 | ファントムカード | 空カードが一覧に表示されないこと |
| 10a | タブ再押下（アルバム） | フォルダ深くで「アルバム」再タップ→ルートフォルダに戻ること |
| 10b | タブ再押下（テンプレート） | 編集画面で「テンプレート」再タップ→一覧に戻ること |
| 10c | タブ再押下（生成） | 「生成」再タップ→スクロールトップに戻ること |

## 完了条件

- 5件すべてが動作すること
- #8, #9 で原因調査の結果、仕様判断が必要な場合は報告に記載（修正せず報告のみでも可）
- ビルド・サーバー再起動・コミット・プッシュ実施済み
- _STATUS.md更新
