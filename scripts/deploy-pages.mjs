import { execSync } from 'child_process';
import fs from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', 'dist');

process.chdir(dist);
execSync('git init', { stdio: 'inherit' });
execSync('git -c user.email="misfortunemate@gmail.com" -c user.name="misfortunemate-png" add .', { stdio: 'inherit' });
const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
execSync(
  `git -c user.email="misfortunemate@gmail.com" -c user.name="misfortunemate-png" commit -m "Deploy v${pkg.version} to GitHub Pages"`,
  { stdio: 'inherit' }
);
execSync('git push -f https://github.com/misfortunemate-png/prompt-vault-dev.git HEAD:gh-pages', { stdio: 'inherit' });
fs.rmSync(resolve(dist, '.git'), { recursive: true, force: true });
console.log(`✓ Deployed v${pkg.version} to gh-pages`);
