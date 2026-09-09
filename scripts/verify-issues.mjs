import { issueVerifiers } from '../tests/issues/manifest.mjs';

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const strictNotRun = argv.includes('--strict-not-run');
const requested = argv.filter((arg) => !arg.startsWith('--'));
const issueIds = requested.length > 0 ? requested : Object.keys(issueVerifiers);

const report = {
  generated_at: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  strict_not_run: strictNotRun,
  issues: [],
};

for (const issueId of issueIds) {
  const verifier = issueVerifiers[issueId];
  if (!verifier) {
    report.issues.push({
      issue: issueId,
      level: 'UNKNOWN',
      status: 'FAIL',
      checks: [{ name: 'verifier registered', status: 'FAIL', detail: `No verifier registered for ${issueId}` }],
    });
    continue;
  }

  let checks;
  try {
    checks = await verifier.verify();
  } catch (error) {
    checks = [{ name: 'verifier execution', status: 'FAIL', detail: error?.stack || error?.message || String(error) }];
  }

  const normalized = checks.map((check) => ({
    name: check.name,
    status: check.status,
    detail: check.detail || '',
  }));
  const hasFail = normalized.some((check) => check.status === 'FAIL');
  const hasNotRun = normalized.some((check) => check.status === 'NOT_RUN');

  report.issues.push({
    issue: verifier.issue,
    title: verifier.title,
    level: verifier.level,
    status: hasFail ? 'FAIL' : hasNotRun ? 'PASS_WITH_NOT_RUN' : 'PASS',
    checks: normalized,
  });
}

report.summary = report.issues.reduce((summary, issue) => {
  summary.issues += 1;
  for (const check of issue.checks) {
    if (check.status === 'PASS') summary.pass += 1;
    else if (check.status === 'FAIL') summary.fail += 1;
    else if (check.status === 'NOT_RUN') summary.not_run += 1;
  }
  return summary;
}, { issues: 0, pass: 0, fail: 0, not_run: 0 });

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const issue of report.issues) {
    console.log(`\n${issue.issue} [${issue.level}] ${issue.title || ''}`.trimEnd());
    for (const check of issue.checks) {
      const marker = check.status === 'PASS' ? 'PASS' : check.status === 'FAIL' ? 'FAIL' : 'NOT RUN';
      console.log(`  ${marker.padEnd(7)} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    }
    console.log(`  VERDICT ${issue.status}`);
  }
  console.log(`\nSUMMARY issues=${report.summary.issues} pass=${report.summary.pass} fail=${report.summary.fail} not_run=${report.summary.not_run}`);
}

const hasFailure = report.summary.fail > 0;
const strictFailure = strictNotRun && report.summary.not_run > 0;
process.exit(hasFailure || strictFailure ? 1 : 0);
