import { readFileSync } from 'node:fs';

function result(name, ok, detail = '') {
  return { name, status: ok ? 'PASS' : 'FAIL', detail: ok ? '' : detail };
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

  async verify() {
    const source = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    let pattern;
    try {
      pattern = extractAllowedPattern(source);
    } catch (error) {
      return [{ name: 'CORS origin matcher extracted', status: 'FAIL', detail: error.message }];
    }

    const cases = [
      ['production origin accepted', 'https://prompt-vault-6gr.pages.dev', true],
      ['hash preview accepted', 'https://abc123.prompt-vault-6gr.pages.dev', true],
      ['hyphenated branch alias accepted', 'https://fix-api.prompt-vault-6gr.pages.dev', true],
      ['multi-hyphen branch alias accepted', 'https://feature-long-name.prompt-vault-6gr.pages.dev', true],
      ['unrelated Pages project rejected', 'https://prompt-vault-evil.pages.dev', false],
      ['lookalike suffix rejected', 'https://fix-api.prompt-vault-6gr.pages.dev.evil.example', false],
    ];

    return cases.map(([name, origin, expected]) => {
      const actual = pattern.test(origin);
      return result(name, actual === expected, `origin=${origin} expected=${expected} actual=${actual} regex=${pattern}`);
    });
  },
};
