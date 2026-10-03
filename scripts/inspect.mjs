import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const results = [];

function check(name, fn) {
  try {
    const ok = fn();
    if (ok === null) {
      results.push({ name, ok: null, msg: 'NOT_RUN' });
    } else {
      results.push({ name, ok, msg: ok ? '' : 'FAILED' });
    }
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
  }
}

// 1. マニフェスト照合
check('マニフェスト照合', () => {
  const instructionsDir = join(ROOT, 'docs', 'instructions');
  if (!existsSync(instructionsDir)) {
    results[results.length] = { name: 'マニフェスト照合', ok: false, msg: 'docs/instructions/ not found' };
    return false;
  }
  const LOCAL_PREFIXES = ['src/', 'docs/', 'scripts/', 'server/', 'public/', 'data/', 'functions/', 'tests/'];
  const files = readdirSync(instructionsDir).filter(f => f.endsWith('.md'));
  let allOk = true;
  for (const file of files) {
    const content = readFileSync(join(instructionsDir, file), 'utf8');
    const pathMatches = content.match(/\|\s*\d+\s*\|\s*([^\|]+?)\s*\|/g);
    if (!pathMatches) continue;
    for (const m of pathMatches) {
      const cols = m.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length < 2) continue;
      const refPath = cols[1];
      if (refPath === '#' || refPath === 'パス' || !refPath.includes('/')) continue;
      if (!LOCAL_PREFIXES.some(p => refPath.startsWith(p))) continue;
      const fullPath = join(ROOT, refPath);
      if (!existsSync(fullPath)) {
        console.log(`  ❌ Missing: ${refPath}`);
        allOk = false;
      }
    }
  }
  return allOk;
});

// 2. 支給物SHA-256照合
check('支給物SHA-256照合', () => {
  const tokensPath = join(ROOT, 'docs', 'supplied', 'tokens.css');
  if (!existsSync(tokensPath)) {
    console.log('  ❌ docs/supplied/tokens.css not found');
    return false;
  }
  const content = readFileSync(tokensPath);
  const lfContent = Buffer.from(content.toString().replace(/\r\n/g, '\n'));
  const hash = createHash('sha256').update(lfContent).digest('hex');
  const expectedSupplied = '4850377ad7e24581657e3117ed64e08b666f183ea05ede51240a13517db2eb07';
  if (hash !== expectedSupplied) {
    console.log(`  ❌ docs/supplied/tokens.css tampered: ${hash}`);
    return false;
  }
  const srcTokens = join(ROOT, 'src', 'tokens.css');
  if (existsSync(srcTokens)) {
    const srcContent = readFileSync(srcTokens);
    const srcLf = Buffer.from(srcContent.toString().replace(/\r\n/g, '\n'));
    const srcHash = createHash('sha256').update(srcLf).digest('hex');
    const expectedSrc = '57a78a3aa386119a89faa861c9d32118c112cde7772a18b42415b879a7a075d6';
    if (srcHash !== expectedSrc) {
      console.log(`  ❌ src/tokens.css unauthorized change: ${srcHash}`);
      return false;
    }
  }
  return true;
});

// 3. 版確認
// T-02: 「起動していない（接続できない）」だけを NOT_RUN とし、応答の異常は理由と元の字句を付けて FAILED にする
check('版確認', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  console.log(`  package.json version: ${pkg.version}`);
  const port = process.env.PORT || 8789;
  const url = `http://localhost:${port}/api/healthz`;
  let out;
  try {
    out = execSync(`curl -sS --max-time 5 -w "\\n__HTTP_STATUS__%{http_code}" ${url}`, { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    const stderr = (e.stderr ? e.stderr.toString() : '').trim();
    if (e.status === 7) {
      console.log(`  ⚠ Server not running — healthz check NOT_RUN（理由: 接続できない curl exit 7 ${stderr}）`);
      return null;
    }
    console.log(`  ❌ healthz の応答に異常（理由: curl exit ${e.status ?? '?'} ${stderr || e.message}）url=${url}`);
    return false;
  }
  const m = out.match(/\r?\n?__HTTP_STATUS__(\d{3})\s*$/);
  const status = m ? Number(m[1]) : null;
  const body = m ? out.slice(0, m.index) : out;
  const rawHead = JSON.stringify(body.slice(0, 200));
  if (status === null) {
    console.log(`  ❌ healthz の状態コードを読めない（理由: curl の出力に印がない）raw=${JSON.stringify(out.slice(-200))}`);
    return false;
  }
  if (status < 200 || status > 299) {
    console.log(`  ❌ healthz HTTP ${status}（理由: 2xx 以外）raw=${rawHead}`);
    return false;
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    console.log(`  ❌ healthz の応答が JSON でない（理由: ${e.message}）raw=${rawHead}`);
    return false;
  }
  if (!data || typeof data.version !== 'string') {
    console.log(`  ❌ healthz の応答に version（文字列）がない（理由: 版を確かめられない）raw=${rawHead}`);
    return false;
  }
  console.log(`  healthz version: ${data.version}`);
  if (pkg.version !== data.version) {
    console.log('  ❌ Version mismatch');
    return false;
  }
  return true;
});

// 4. _STATUS.md 行数チェック
check('_STATUS.md 行数', () => {
  const statusPath = join(ROOT, '_STATUS.md');
  if (!existsSync(statusPath)) {
    console.log('  ❌ _STATUS.md not found');
    return false;
  }
  const lines = readFileSync(statusPath, 'utf8').split('\n').length;
  console.log(`  Lines: ${lines}`);
  if (lines > 30) {
    console.log('  ❌ Exceeds 30 lines');
    return false;
  }
  return true;
});

// 5. danbooru-filtered.csv SHA-256
check('danbooru-filtered.csv SHA-256', () => {
  const csvPath = join(ROOT, 'docs', 'supplied', 'danbooru-filtered.csv');
  if (!existsSync(csvPath)) {
    console.log('  ❌ docs/supplied/danbooru-filtered.csv not found');
    return false;
  }
  const content = readFileSync(csvPath);
  const lfContent = Buffer.from(content.toString().replace(/\r\n/g, '\n'));
  const hash = createHash('sha256').update(lfContent).digest('hex');
  const expected = 'fd9f677d2f0bdab7e1bf644a9ea76a1e5d861b7698e3b0d06a6158df465e13f7';
  if (hash !== expected) {
    console.log(`  ❌ Hash mismatch: ${hash}`);
    return false;
  }
  return true;
});

// 6. ビルド確認
check('ビルド確認', () => {
  try {
    const output = execSync('npm run build 2>&1', { cwd: ROOT, timeout: 60000 }).toString();
    if (output.toLowerCase().includes('warning')) {
      console.log('  ⚠ Build warnings detected');
      console.log(output);
    }
    return true;
  } catch (e) {
    console.log(`  ❌ Build failed: ${e.message}`);
    return false;
  }
});

// Summary
console.log('\n=== Inspect Results ===\n');
let allGreen = true;
let hasNotRun = false;
for (const r of results) {
  const icon = r.ok === true ? '✅' : r.ok === null ? '⚠' : '❌';
  console.log(`${icon} ${r.name}${r.msg ? ': ' + r.msg : ''}`);
  if (r.ok === false) allGreen = false;
  if (r.ok === null) hasNotRun = true;
}
console.log('');
if (allGreen) {
  if (hasNotRun) {
    console.log('=== PASS (一部 NOT_RUN) ===');
  } else {
    console.log('=== ALL GREEN ===');
  }
} else {
  console.log('=== SOME CHECKS FAILED ===');
  process.exit(1);
}
