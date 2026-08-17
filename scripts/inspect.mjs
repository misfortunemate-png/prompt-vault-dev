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
    results.push({ name, ok, msg: ok ? '' : 'FAILED' });
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
  const expected = '4850377ad7e24581657e3117ed64e08b666f183ea05ede51240a13517db2eb07';
  if (hash !== expected) {
    console.log(`  ❌ Hash mismatch: ${hash}`);
    return false;
  }
  const srcTokens = join(ROOT, 'src', 'tokens.css');
  if (existsSync(srcTokens)) {
    const srcContent = readFileSync(srcTokens);
    const srcLf = Buffer.from(srcContent.toString().replace(/\r\n/g, '\n'));
    const srcHash = createHash('sha256').update(srcLf).digest('hex');
    if (srcHash !== expected) {
      console.log(`  ❌ src/tokens.css differs from supplied`);
      return false;
    }
  }
  return true;
});

// 3. 版確認
check('版確認', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  console.log(`  package.json version: ${pkg.version}`);
  try {
    const port = process.env.PORT || 8789;
    const resp = execSync(`curl -s http://localhost:${port}/vault/api/healthz`, { timeout: 5000 });
    const data = JSON.parse(resp.toString());
    console.log(`  healthz version: ${data.version}`);
    if (pkg.version !== data.version) {
      console.log('  ❌ Version mismatch');
      return false;
    }
  } catch {
    console.log('  ⚠ Server not running, skipping healthz check');
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

// 5. ビルド確認
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
for (const r of results) {
  const icon = r.ok ? '✅' : '❌';
  console.log(`${icon} ${r.name}${r.msg ? ': ' + r.msg : ''}`);
  if (!r.ok) allGreen = false;
}
console.log('');
if (allGreen) {
  console.log('=== ALL GREEN ===');
} else {
  console.log('=== SOME CHECKS FAILED ===');
  process.exit(1);
}
