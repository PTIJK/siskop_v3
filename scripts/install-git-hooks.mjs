import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const existing = (() => { try { return git('config', '--get', 'core.hooksPath'); } catch { return ''; } })();
if (existing && existing !== '.githooks') {
  throw new Error('Existing core.hooksPath found. Integrate SISKOP pre-push checks with that hook before changing it.');
}
const oldHook = git('rev-parse', '--git-path', 'hooks/pre-push');
if (!existing && fs.existsSync(oldHook)) {
  throw new Error('Existing pre-push hook found. Integrate it before installing SISKOP hooks.');
}
fs.chmodSync('.githooks/pre-push', 0o755);
git('config', '--local', 'core.hooksPath', '.githooks');
console.log('SISKOP pre-push installed. Each git push runs affected checks before uploading refs.');
