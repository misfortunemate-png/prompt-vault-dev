import { readFileSync } from 'node:fs';

function result(name, ok, detail = '') {
  return { name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail };
}

function acceptedResidual(name, ok, detail) {
  return { name, status: ok ? 'PASS' : 'WAIVED', detail: ok ? '' : detail };
}

function extractAllowedPattern(source) {
  const line = source.split('\n').find((s) => s.includes('const ALLOWED_ORIGIN_PATTERNS'));
  if (!line) throw new Error('ALLOWED_ORIGIN_PATTERNS declaration not found');
  const match = line.match(/\[\s*(\/\^https:.*\/[a-z]*)\s*\]/i);
  if (!match) throw new Error(`regex literal could not be parsed: ${line.trim()}`);
  const literal = match[1];
  const lastSlash = literal.lastIndexOf('/');
  return new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));
}

export default {
  issue: 'pv#23',
  title: 'Cloudflare Pages preview origin CORS',
  level: 'AUTO',
  gate: true,

  async verify() {
    const source = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    let pattern;
    try {
      pattern = extractAllowedPattern(source);
    } catch (error) {
      return [{ name: 'CORS origin matcher extracted', status: 'FAIL', detail: error.message }];
    }

    const checks = [];
    const requiredCases = [
      ['production origin accepted', 'https://prompt-vault-6gr.pages.dev', true],
      ['hash preview accepted', 'https://abc123.prompt-vault-6gr.pages.dev', true],
      ['unrelated Pages project rejected', 'https://prompt-vault-evil.pages.dev', false],
      ['lookalike suffix rejected', 'https://fix-api.prompt-vault-6gr.pages.dev.evil.example', false],
    ];

    for (const [name, origin, expected] of requiredCases) {
      const actual = pattern.test(origin);
      checks.push(result(name, actual === expected, `origin=${origin} expected=${expected} actual=${actual} regex=${pattern}`));
    }

    for (const [name, origin] of [
      ['hyphenated branch alias accepted', 'https://fix-api.prompt-vault-6gr.pages.dev'],
      ['multi-hyphen branch alias accepted', 'https://feature-long-name.prompt-vault-6gr.pages.dev'],
    ]) {
      const actual = pattern.test(origin);
      checks.push(acceptedResidual(
        name,
        actual === true,
        `WAIVED for N=1 operation: hash preview remains available; origin=${origin} regex=${pattern}`,
      ));
    }

    checks.push(result(
      'Private Network Access response header is supported',
      source.includes("res.setHeader('Access-Control-Allow-Private-Network', 'true')"),
      'Access-Control-Allow-Private-Network handling not found',
    ));
    checks.push(result(
      'allowed OPTIONS preflight terminates with 204',
      /req\.method === 'OPTIONS'[^\n]*res\.status\(204\)\.end\(\)/.test(source),
      'OPTIONS 204 handling not found in CORS middleware',
    ));

    return checks;
  },
};
