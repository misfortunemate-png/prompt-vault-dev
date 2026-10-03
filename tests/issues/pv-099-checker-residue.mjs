// pv#99: 検査スクリプトが未知の判定を PASS に寄せない（T-01〜T-03・J-15）
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { repoRoot, makeTempRoot, removeTempRoot } from './lib/fran-harness.mjs';
import { check } from './lib/front-env.mjs';

// 模擬 verifier（fixture）。status に当たらない値を返す
const FIXTURE_MANIFEST = `
const mk = (issue, checks) => ({ issue, title: 'fixture ' + issue, level: 'AUTO', gate: true, async verify() { return checks; } });
export const issueVerifiers = Object.freeze({
  'fx#ERROR': mk('fx#ERROR', [{ name: 'ok', status: 'PASS' }, { name: 'odd', status: 'ERROR', detail: 'boom' }]),
  'fx#lower': mk('fx#lower', [{ name: 'lower', status: 'pass' }]),
  'fx#undef': mk('fx#undef', [{ name: 'nostatus' }]),
  'fx#notarray': { issue: 'fx#notarray', title: 'fixture', level: 'AUTO', gate: true, async verify() { return { status: 'PASS' }; } },
  'fx#control': mk('fx#control', [{ name: 'fine', status: 'PASS' }]),
});
`;

function runVerifyIssues(root, args) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'verify-issues.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function runAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, windowsHide: true });
    let out = '';
    child.stdout?.on('data', d => { out += d; });
    child.stderr?.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill(), opts.timeout ?? 60000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

async function withHttp(handler, fn) {
  const srv = createServer(handler);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try { return await fn(srv.address().port); } finally { await new Promise(r => srv.close(r)); }
}

// inspect の「版確認」節だけを取り出す
function versionSection(out) {
  const start = out.indexOf('package.json version');
  const end = out.indexOf('Lines:', start);
  return start >= 0 ? out.slice(start, end >= 0 ? end : start + 600) : '';
}
function versionResultLine(out) {
  return (out.split('\n').find(l => /^(✅|⚠|❌) 版確認/.test(l.trim())) || '').trim();
}

export default {
  issue: 'pv#99',
  title: 'Checker scripts must not fold unknown verdicts/values into PASS or defaults',
  level: 'AUTO_FAILURE_INJECTION',
  gate: true,
  verifierPath: 'tests/issues/pv-099-checker-residue.mjs',

  async verify() {
    const checks = [];

    // ── T-01: verify-issues ──
    const root = makeTempRoot('pv099');
    try {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      mkdirSync(join(root, 'tests', 'issues'), { recursive: true });
      copyFileSync(join(repoRoot, 'scripts', 'verify-issues.mjs'), join(root, 'scripts', 'verify-issues.mjs'));
      writeFileSync(join(root, 'tests', 'issues', 'manifest.mjs'), FIXTURE_MANIFEST);

      for (const [id, raw] of [['fx#ERROR', 'ERROR'], ['fx#lower', 'pass'], ['fx#undef', 'undefined'], ['fx#notarray', '{"status":"PASS"}']]) {
        const r = runVerifyIssues(root, [id]);
        const verdict = (r.out.match(/VERDICT (\S+)/) || [])[1];
        const summary = (r.out.match(/SUMMARY .*/) || [''])[0];
        checks.push(check(`T-01: ${id} (status ${raw}) is not judged PASS`, verdict && !verdict.startsWith('PASS'), `verdict=${verdict}\n${r.out.slice(-500)}`));
        checks.push(check(`T-01: ${id} is counted in the summary`, /unknown=[1-9]/.test(summary), `summary=${summary}`));
        checks.push(check(`T-01: ${id} makes the exit code non-zero`, r.code !== 0, `exit=${r.code}`));
        checks.push(check(`T-01: ${id} output shows the raw value and a reason`, r.out.includes(raw) && /理由|reason/i.test(r.out), r.out.slice(-500)));
      }
      const ctl = runVerifyIssues(root, ['fx#control']);
      checks.push(check('T-01 control: a PASS-only verifier still passes with exit 0',
        /VERDICT PASS\b/.test(ctl.out) && ctl.code === 0, `exit=${ctl.code}\n${ctl.out.slice(-300)}`));
      const typo = runVerifyIssues(root, ['--strict-al', 'fx#control']);
      checks.push(check('T-01: an unknown flag is rejected with exit 64 and the raw flag', typo.code === 64 && typo.out.includes('--strict-al'),
        `exit=${typo.code}\n${typo.out.slice(-300)}`));
    } finally {
      removeTempRoot(root);
    }

    // ── T-02: inspect の版確認 ──
    // 写しは repo の外（OS の一時領域）で回す。ビルド確認が repo の npm を拾わないため
    const ext = mkdtempSync(join(tmpdir(), 'pv099-inspect-'));
    try {
      mkdirSync(join(ext, 'scripts'), { recursive: true });
      copyFileSync(join(repoRoot, 'scripts', 'inspect.mjs'), join(ext, 'scripts', 'inspect.mjs'));
      writeFileSync(join(ext, 'package.json'), JSON.stringify({ name: 'fixture', version: '9.9.9' }));
      const runInspect = (port) => runAsync(process.execPath, [join(ext, 'scripts', 'inspect.mjs')], {
        cwd: ext, env: { ...process.env, PORT: String(port) }, timeout: 90000,
      });

      const cases = [
        ['HTTP 500', (req, res) => { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('internal boom'); }, /500[\s\S]*internal boom/],
        ['non-JSON 200', (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>spa</title>'); }, /<!doctype html>/i],
        ['JSON without version', (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); }, /\{\\?"status\\?":\\?"ok\\?"\}/],
      ];
      for (const [label, handler, rawRe] of cases) {
        const r = await withHttp(handler, (port) => runInspect(port));
        const sec = versionSection(r.out);
        const line = versionResultLine(r.out);
        checks.push(check(`T-02: ${label} is reported as an anomaly, not "Server not running"`,
          !/not running/i.test(sec) && line.startsWith('❌'), `line=${line}\n${sec}`));
        checks.push(check(`T-02: ${label} output carries the raw response and a reason`, rawRe.test(sec), sec));
      }
      // 起動していない: 空いているポートに向ける
      const freePort = await withHttp((q, s) => s.end(), async (p) => p);
      const nr = await runInspect(freePort);
      const nrSec = versionSection(nr.out);
      checks.push(check('T-02: no listener is reported as not running (NOT_RUN) with a reason',
        /not running/i.test(nrSec) && versionResultLine(nr.out).startsWith('⚠') && /理由|reason|ECONNREFUSED|connect/i.test(nrSec), nrSec));
    } finally {
      try { rmSync(ext, { recursive: true, force: true }); } catch {}
    }

    // ── T-03: review-doctor の引数 ──
    for (const arg of ['--port=abc', '--port=0', '--port=70000', '--timeout-ms=abc', '--timeout-ms=-5', '--port=']) {
      const r = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'review-doctor.mjs'), arg, '--json'], { cwd: repoRoot, encoding: 'utf8', timeout: 60000 });
      const out = (r.stdout || '') + (r.stderr || '');
      checks.push(check(`T-03: review-doctor ${arg} exits 64 with the raw value and a reason`,
        r.status === 64 && out.includes(arg.split('=')[1] === '' ? arg : arg.split('=')[1]) && /理由|must|整数|invalid/i.test(out),
        `exit=${r.status}\n${out.slice(0, 300)}`));
    }

    return checks;
  },
};
