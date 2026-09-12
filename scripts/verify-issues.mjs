import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { issueVerifiers } from '../tests/issues/manifest.mjs';

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const strictAll = argv.includes('--strict-all');
const strictNotRun = argv.includes('--strict-not-run');
const requested = argv.filter((arg) => !arg.startsWith('--'));
const issueIds = requested.length > 0 ? requested : Object.keys(issueVerifiers);

function currentGitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return 'unknown'; }
}
function verifierSha256(verifierPath) {
  if (!verifierPath) return null;
  try { return createHash('sha256').update(readFileSync(resolve(process.cwd(), verifierPath))).digest('hex'); }
  catch { return null; }
}

const report = { generated_at: new Date().toISOString(), repository_sha: currentGitSha(), platform: process.platform, node: process.version, strict_all: strictAll, strict_not_run: strictNotRun, issues: [] };

for (const issueId of issueIds) {
  const verifier = issueVerifiers[issueId];
  if (!verifier) {
    report.issues.push({ issue: issueId, level: 'UNKNOWN', gate: true, status: 'FAIL', verifier_path: null, verifier_sha256: null, checks: [{ name: 'verifier registered', status: 'FAIL', detail: `No verifier registered for ${issueId}` }] });
    continue;
  }
  let checks;
  try { checks = await verifier.verify(); }
  catch (error) { checks = [{ name: 'verifier execution', status: 'FAIL', detail: error?.stack || error?.message || String(error) }]; }
  const normalized = checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail || '' }));
  const hasFail = normalized.some((c) => c.status === 'FAIL');
  const hasNotRun = normalized.some((c) => c.status === 'NOT_RUN');
  const hasWaived = normalized.some((c) => c.status === 'WAIVED');
  const status = hasFail ? 'FAIL' : hasNotRun ? 'PASS_WITH_NOT_RUN' : hasWaived ? 'PASS_WITH_WAIVER' : 'PASS';
  report.issues.push({ issue: verifier.issue, title: verifier.title, level: verifier.level, gate: verifier.gate !== false, status, verifier_path: verifier.verifierPath || null, verifier_sha256: verifierSha256(verifier.verifierPath), checks: normalized });
}

report.summary = report.issues.reduce((s, issue) => {
  s.issues += 1; if (issue.gate) s.gated_issues += 1;
  for (const c of issue.checks) {
    if (c.status === 'PASS') s.pass += 1;
    else if (c.status === 'FAIL') { s.fail += 1; if (issue.gate) s.gated_fail += 1; }
    else if (c.status === 'NOT_RUN') s.not_run += 1;
    else if (c.status === 'WAIVED') s.waived += 1;
  }
  return s;
}, { issues: 0, gated_issues: 0, pass: 0, fail: 0, gated_fail: 0, not_run: 0, waived: 0 });

if (jsonMode) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`repository_sha=${report.repository_sha}`);
  for (const issue of report.issues) {
    console.log(`\n${issue.issue} [${issue.level}] gate=${issue.gate} ${issue.title || ''}`.trimEnd());
    if (issue.verifier_path) console.log(`  VERIFIER ${issue.verifier_path} sha256=${issue.verifier_sha256 || 'unknown'}`);
    for (const c of issue.checks) console.log(`  ${(c.status === 'NOT_RUN' ? 'NOT RUN' : c.status).padEnd(7)} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    console.log(`  VERDICT ${issue.status}`);
  }
  console.log(`\nSUMMARY issues=${report.summary.issues} gated=${report.summary.gated_issues} pass=${report.summary.pass} fail=${report.summary.fail} gated_fail=${report.summary.gated_fail} not_run=${report.summary.not_run} waived=${report.summary.waived}`);
}
const anyFailure = report.summary.fail > 0;
const gatedFailure = report.summary.gated_fail > 0;
const notRunFailure = strictNotRun && report.summary.not_run > 0;
process.exit((strictAll ? anyFailure : gatedFailure) || notRunFailure ? 1 : 0);
