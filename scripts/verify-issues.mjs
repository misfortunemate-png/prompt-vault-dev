import { issueVerifiers } from '../tests/issues/manifest.mjs';

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const strictAll = argv.includes('--strict-all');
const strictNotRun = argv.includes('--strict-not-run');
const requested = argv.filter((arg) => !arg.startsWith('--'));
const issueIds = requested.length > 0 ? requested : Object.keys(issueVerifiers);

const report = {
  generated_at: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  strict_all: strictAll,
  strict_not_run: strictNotRun,
  issues: [],
};

for (const issueId of issueIds) {
  const verifier = issueVerifiers[issueId];
  if (!verifier) {
    report.issues.push({
      issue: issueId,
      level: 'UNKNOWN',
      gate: true,
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
  const hasWaived = normalized.some((check) => check.status === 'WAIVED');
  const status = hasFail ? 'FAIL'
    : hasNotRun ? 'PASS_WITH_NOT_RUN'
      : hasWaived ? 'PASS_WITH_WAIVER'
        : 'PASS';

  report.issues.push({
    issue: verifier.issue,
    title: verifier.title,
    level: verifier.level,
    gate: verifier.gate !== false,
    status,
    checks: normalized,
  });
}

report.summary = report.issues.reduce((summary, issue) => {
  summary.issues += 1;
  if (issue.gate) summary.gated_issues += 1;
  for (const check of issue.checks) {
    if (check.status === 'PASS') summary.pass += 1;
    else if (check.status === 'FAIL') {
      summary.fail += 1;
      if (issue.gate) summary.gated_fail += 1;
    } else if (check.status === 'NOT_RUN') summary.not_run += 1;
    else if (check.status === 'WAIVED') summary.waived += 1;
  }
  return summary;
}, { issues: 0, gated_issues: 0, pass: 0, fail: 0, gated_fail: 0, not_run: 0, waived: 0 });

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const issue of report.issues) {
    console.log(`\n${issue.issue} [${issue.level}] gate=${issue.gate} ${issue.title || ''}`.trimEnd());
    for (const check of issue.checks) {
      const marker = check.status === 'NOT_RUN' ? 'NOT RUN' : check.status;
      console.log(`  ${marker.padEnd(7)} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    }
    console.log(`  VERDICT ${issue.status}`);
  }
  console.log(`\nSUMMARY issues=${report.summary.issues} gated=${report.summary.gated_issues} pass=${report.summary.pass} fail=${report.summary.fail} gated_fail=${report.summary.gated_fail} not_run=${report.summary.not_run} waived=${report.summary.waived}`);
}

const anyFailure = report.summary.fail > 0;
const gatedFailure = report.summary.gated_fail > 0;
const notRunFailure = strictNotRun && report.summary.not_run > 0;
process.exit((strictAll ? anyFailure : gatedFailure) || notRunFailure ? 1 : 0);
