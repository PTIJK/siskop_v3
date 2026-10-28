import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeTestDatabase } from './test-postgres.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const all = ['@siskop/frontend', '@siskop/mobile', '@siskop/backend', '@siskop/types'];
const folders = { frontend: '@siskop/frontend', mobile: '@siskop/mobile', backend: '@siskop/backend' };

export function planChecks(files) {
  const workspaces = new Set();
  const commands = new Map();
  const add = (...args) => commands.set(JSON.stringify(args), args);
  for (const file of files) {
    if (/^(pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|turbo\.json)$/.test(file) ||
        file.startsWith('packages/types/') || file.startsWith('packages/eslint-config/')) {
      all.forEach(name => workspaces.add(name));
    }
    for (const [folder, workspace] of Object.entries(folders)) {
      if (file.startsWith(`apps/${folder}/`)) workspaces.add(workspace);
    }
    if (file.startsWith('scripts/') || file.startsWith('.githooks/') || file === 'package.json') {
      add('node', '--test', 'scripts/pre-push.test.mjs');
    }
    if (file.startsWith('infra/firebase/') || file.startsWith('.github/workflows/')) {
      add('python3', '-m', 'unittest', 'discover', '-s', 'infra/firebase/tests', '-v');
      add('node', '--test', 'infra/firebase/ci-proof.test.mjs', 'infra/firebase/scheduler.test.mjs');
    }
    if (file.startsWith('infra/contabo/')) add('python3', '-m', 'unittest', 'discover', '-s', 'infra/contabo/siskop', '-p', 'test_*.py', '-v');
    if (file.startsWith('infra/central-gateway/')) add('node', '--test', 'infra/central-gateway/server.test.mjs');
    if (file.startsWith('infra/tenant-web/')) add('node', '--test', 'infra/tenant-web/server.test.mjs');
  }
  return { workspaces: [...workspaces].sort(), commands: [...commands.values()] };
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function changedFiles(input, remote = 'origin') {
  const head = git('rev-parse', 'HEAD');
  const files = new Set();
  for (const row of input.trim().split('\n').filter(Boolean)) {
    const fields = row.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error('Invalid Git pre-push ref input.');
    const [localRef, localSha, , remoteSha] = fields;
    if (!/^[a-f0-9]{40,64}$/.test(localSha) || !/^[a-f0-9]{40,64}$/.test(remoteSha)) throw new Error('Invalid Git object ID.');
    if (/^0+$/.test(localSha)) continue; // Ref deletion has no new code to check.
    const commit = git('rev-parse', `${localSha}^{commit}`);
    if (commit !== head) throw new Error('Push the checked-out commit only; check out other branch/tag commits before pushing them.');
    let base;
    try {
      if (!/^0+$/.test(remoteSha)) base = git('rev-parse', '--verify', `${remoteSha}^{commit}`);
    } catch { /* A missing remote object falls back to the local main merge-base. */ }
    if (!base) {
      try { base = git('merge-base', head, `refs/remotes/${remote}/main`); } catch { /* New clone/repository: check every tracked file. */ }
    }
    const names = base ? git('diff', '--name-only', '--no-renames', '-z', base, head) : git('ls-tree', '-r', '--name-only', '-z', head);
    for (const name of names.split('\0').filter(Boolean)) files.add(name);
    console.log(`[SISKOP pre-push] Checking ${localRef} before upload.`);
    // Root manifests also contain scripts/docs changes. Only dependency/toolchain
    // changes need every workspace; malformed manifests fail rather than skip.
    if (files.has('package.json') && base) {
      const before = JSON.parse(git('show', `${base}:package.json`));
      const after = JSON.parse(git('show', `${head}:package.json`));
      const keys = ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides', 'pnpm', 'engines', 'packageManager'];
      if (keys.some(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])) ||
          ['lint', 'typecheck', 'test', 'build'].some(key => before.scripts?.[key] !== after.scripts?.[key])) files.add('pnpm-lock.yaml');
    } else if (files.has('package.json')) files.add('pnpm-lock.yaml');
  }
  return [...files];
}

function run(args, env = process.env) {
  console.log(`[SISKOP pre-push] ${args.join(' ')}`);
  const result = spawnSync(args[0], args.slice(1), { cwd: root, stdio: 'inherit', env });
  if (result.error || result.status !== 0) throw new Error(`Check failed: ${args.join(' ')}. Push blocked.`);
}

function assertClean(head) {
  if (git('status', '--porcelain', '--untracked-files=normal')) throw new Error('Commit or stash local changes before pushing; checks must match the pushed commit.');
  if (git('rev-parse', 'HEAD') !== head) throw new Error('HEAD changed during checks. Push blocked; retry from the intended commit.');
}

function backendDatabase() {
  if (process.env.SISKOP_TEST_POSTGRES_BIN) {
    const local = nativeTestDatabase(process.env.SISKOP_TEST_POSTGRES_BIN);
    return { close: local.close, env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: local.url,
      JWT_SECRET: 'siskop-prepush-test-only', JWT_REFRESH_SECRET: 'siskop-prepush-refresh-only', JWT_EXPIRES_IN: '15m' } };
  }
  const name = `siskop-prepush-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const password = crypto.randomBytes(24).toString('hex');
  let created = false;
  const cleanup = () => { if (created) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); };
  // Only this newly created container is ever removed. No existing DB URL is read.
  const signals = new Map();
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const handler = () => { cleanup(); process.exit(code); };
    signals.set(signal, handler);
    process.once(signal, handler);
  }
  const close = () => { cleanup(); for (const [signal, handler] of signals) process.removeListener(signal, handler); };
  try {
    const contexts = JSON.parse(execFileSync('docker', ['context', 'inspect'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const endpoint = process.env.DOCKER_HOST || contexts[0]?.Endpoints?.docker?.Host || '';
    if (!/^(unix|npipe):\/\//.test(endpoint)) throw new Error('Backend checks require local Docker; remote Docker endpoints are not allowed.');
    const result = spawnSync('docker', ['run', '--rm', '-d', '--name', name,
      '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=siskop_prepush_test',
      '-p', '127.0.0.1::5432', 'postgres:17'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error('Backend checks require running Docker and postgres:17. Start Docker, then retry push.');
    created = true;
    const address = execFileSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' }).trim();
    if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Disposable database must bind loopback only.');
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (!ready) throw new Error('Disposable test database did not become ready.');
    return { close, env: { ...process.env, NODE_ENV: 'test',
      DATABASE_URL: `postgresql://postgres:${password}@${address}/siskop_prepush_test`,
      JWT_SECRET: 'siskop-prepush-test-only', JWT_REFRESH_SECRET: 'siskop-prepush-refresh-only', JWT_EXPIRES_IN: '15m' } };
  } catch (error) { close(); throw error; }
}

export function main() {
  process.chdir(root);
  const manual = process.argv[2] === '--check';
  const head = git('rev-parse', 'HEAD');
  const input = manual ? `HEAD ${head} refs/heads/manual ${'0'.repeat(head.length)}` : fs.readFileSync(0, 'utf8');
  const files = changedFiles(input, manual ? 'origin' : (process.argv[2] || 'origin'));
  if (!files.length) { console.log('[SISKOP pre-push] No changed files to check.'); return; }
  assertClean(head);
  const plan = planChecks(files);
  let database;
  try {
    for (const command of plan.commands) run(command);
    if (plan.workspaces.includes('@siskop/backend')) {
      database = backendDatabase();
      run(['pnpm', '--filter', '@siskop/backend', 'db:generate'], database.env);
      run(['pnpm', '--filter', '@siskop/backend', 'exec', 'prisma', 'migrate', 'deploy'], database.env);
    }
    if (plan.workspaces.length) {
      run(['pnpm', 'exec', 'turbo', 'run', 'lint', 'typecheck', ...plan.workspaces.map(name => `--filter=${name}`)], database?.env);
      if (plan.workspaces.includes('@siskop/frontend')) run(['pnpm', '--filter', '@siskop/frontend', 'test'], database?.env);
      if (plan.workspaces.includes('@siskop/backend')) run(['pnpm', '--filter', '@siskop/backend', 'test'], database.env);
    }
    assertClean(head);
    console.log('[SISKOP pre-push] PASS. Git may upload the checked commit.');
  } finally { database?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`[SISKOP pre-push] ${error.message}`); process.exitCode = 1; }
}
