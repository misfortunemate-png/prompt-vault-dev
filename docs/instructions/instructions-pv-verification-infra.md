# ⑥ 検証基盤の残Issue 一括修正 作業指示書
文書種別: 権威文書（簡略フロー）

作成日: 2026-09-12 ／ PM: クリーデ
上位文書: ai-family-ops/docs/20260910_pv-review2_remediation-policy_v1.0.md §2-⑥

対象Issue:
- prompt-vault-dev: #24（CI不在）、#27（Fran SHA/restart非スクリプト化）、#28（Pages手動deploy）
- ai-family-foundation: #22（CI不在）、#23（inspect NOT_RUN表現不可）、#26（dirty deploy）

## PG運用規律（定型）

1. **停止条件**: 仕様にない判断が必要／技術的に実現困難
2. **着工前**: 各リポジトリで `git pull` → inspect

---

## 手順1: GitHub Actions CI導入（pv-dev #24 + foundation #22）

両リポジトリに `.github/workflows/ci.yml` を作成する。

### prompt-vault-dev

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm run build:pages
```

inspectはフラン環境依存（VAULT_ROOT、server起動）のためCIに含めない。CIの対象は`build`のみ（Issue #1のモジュール欠損はこれで防げる）。

### ai-family-foundation

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
```

コミット: 各リポジトリで `ci: add GitHub Actions build workflow (#24/#22)`

---

## 手順2: Fran healthzにcommit SHA公開（pv-dev #27）

`server.js` のhealthzレスポンスにGit HEAD SHAを追加する。

起動時に1回だけSHAを取得して定数に保持する:

```javascript
import { execSync } from 'child_process';

let GIT_SHA = 'unknown';
try {
  GIT_SHA = execSync('git rev-parse --short HEAD', { encoding: 'utf8', timeout: 3000 }).trim();
} catch {}
```

healthzレスポンスに追加:

```javascript
api.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', version: pkg.version, sha: GIT_SHA });
});
```

pull/restartスクリプトの新設は§0（新機能禁止）に抵触するため行わない。SHAの公開のみで、deploy検証は人が`/healthz`を見て判断する。

コミット: `fix(#27): expose git SHA in healthz response`

---

## 手順3: GitHub Pages自動deploy（pv-dev #28）

CI workflowに Pages deploy ジョブを追加する。手順1の`ci.yml`を拡張:

```yaml
  deploy-pages:
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run build:pages
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist-pages
      - id: deployment
        uses: actions/deploy-pages@v4
```

GitHub Settings → Pages → Source を「GitHub Actions」に変更する必要がある。PGが設定変更できない場合は報告に記載し、発注者に依頼する。

`dist-pages` は `npm run build:pages` の出力ディレクトリ。異なる場合はpackage.jsonのbuild:pagesスクリプトを確認して合わせる。

コミット: `ci(#28): add automated GitHub Pages deploy on main push`

---

## 手順4: inspect NOT_RUN表現（foundation #23）

`scripts/inspect.mjs` を修正し、動的検査をスキップした場合に`NOT_RUN`を明示する。

現行: 環境変数がなければ静的検査のみでexit 0（ALL GREEN）。
修正: スキップした検査項目を`NOT_RUN`として表示し、exit 0だが出力を区別する。

```javascript
// 動的検査ブロック
if (EVIDENCE_TARGET || EVIDENCE_TARGET_URL) {
  // ... 既存の動的検査 ...
} else {
  console.log('=== 動的検査: NOT_RUN (EVIDENCE_TARGET未設定) ===');
  notRunCount++;
}

// 最終出力
if (!ok) {
  console.log('\n❌ FAIL');
  process.exit(1);
} else if (notRunCount > 0) {
  console.log(`\n⚠️ PASS with ${notRunCount} NOT_RUN`);
  process.exit(0);  // CIは止めない
} else {
  console.log('\n✅ ALL GREEN');
  process.exit(0);
}
```

`ALL GREEN`は全検査PASSの場合のみ表示する。NOT_RUNがあれば`PASS with N NOT_RUN`とする。exit 0は維持（CIを止めない）。

コミット: `fix(#23): distinguish NOT_RUN from ALL GREEN in inspect output`

---

## 手順5: dirty worktree deploy防止（foundation #26）

`package.json` の`deploy`スクリプトにworktreeクリーンチェックを追加する。

方法: deployスクリプトをシェルコマンドチェーン化:

```json
"deploy": "node -e \"const{execSync}=require('child_process');if(execSync('git status --porcelain',{encoding:'utf8'}).trim()){console.error('ERROR: dirty worktree — commit or stash before deploy');process.exit(1)}\" && wrangler deploy"
```

またはpre-deployスクリプトを分離:

```json
"predeploy": "node scripts/check-clean-worktree.mjs",
"deploy": "wrangler deploy"
```

`scripts/check-clean-worktree.mjs`:

```javascript
import { execSync } from 'child_process';
const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
if (status) {
  console.error('ERROR: dirty worktree — commit or stash before deploy');
  console.error(status);
  process.exit(1);
}
```

npmはpre<script>を自動実行するため、`npm run deploy`で自動的にチェックが走る。

コミット: `fix(#26): block deploy from dirty worktree`

---

## コミット指針

### prompt-vault-dev
1. `ci: add GitHub Actions build workflow (#24)`（ci.yml + Pages deploy）
2. `fix(#27): expose git SHA in healthz response`
3. `ci(#28): add automated GitHub Pages deploy on main push`（手順1と統合可）

### ai-family-foundation
1. `ci: add GitHub Actions build workflow (#22)`
2. `fix(#23): distinguish NOT_RUN from ALL GREEN in inspect output`
3. `fix(#26): block deploy from dirty worktree`

## テスト

- PG自己完結分:
  - 両リポジトリのinspect合格
  - pv-dev: `npm run build` 成功
  - 手順2: healthzレスポンスに`sha`フィールドが含まれること
  - 手順4: EVIDENCE_TARGET未設定でinspectを実行し、`NOT_RUN`表示＋exit 0を確認
  - 手順5: uncommitted変更がある状態で`npm run deploy --dry-run`（またはpredeploy単体実行）がexit 1になること
- NOT RUN:
  - GitHub Actions CIの実行確認（push後にActionsタブで確認。PGからは確認不可の場合あり）
  - GitHub Pages自動deployの確認（Settings変更が必要な場合は発注者に依頼）

## 完了条件

1. 両リポジトリに`.github/workflows/ci.yml`が存在すること
2. pv-devのhealthzに`sha`フィールドが含まれること
3. pv-devのci.ymlにPages deploy jobが含まれること
4. foundation inspectがNOT_RUNとALL GREENを区別すること
5. foundation `npm run deploy`がdirty worktreeでexit 1になること
6. 各inspect合格

## 報告基準

1. 手順1〜5の実施結果
2. 完了条件の充足状況
3. GitHub Pages Settings変更の要否
4. inspect結果
5. NOT RUN項目
