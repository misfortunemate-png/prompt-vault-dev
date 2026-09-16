import fs from 'node:fs';

const fallback = fs.readFileSync(new URL('../src/lib/cloudFetchFallback.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

const checks = [
  ['fallback installed before App', main.includes("import './lib/cloudFetchFallback.js';")],
  ['only GET retries', fallback.includes("if (method !== 'GET') throw primaryError")],
  ['Bearer is removed on retry', fallback.includes("headers.delete('Authorization')")],
  ['query token fallback is used', fallback.includes("url.searchParams.set('token', token)")],
  ['fallback limited to Prompt Vault', fallback.includes("isPromptVaultCloudUrl(url)")],
  ['retry disables cache', fallback.includes("cache: 'no-store'")],
  ['retry suppresses referrer', fallback.includes("referrerPolicy: 'no-referrer'")],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
