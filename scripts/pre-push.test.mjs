import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { planChecks } from './pre-push.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('frontend changes select frontend lint, typechecks and tests only', () => {
  assert.deepEqual(planChecks(['apps/frontend/src/App.tsx']).workspaces, ['@siskop/frontend']);
  assert.deepEqual(planChecks(['apps/mobile/src/App.tsx']).workspaces, ['@siskop/mobile']);
  assert.deepEqual(planChecks(['apps/backend/prisma/schema.prisma']).workspaces, ['@siskop/backend']);
});

test('shared dependencies select every consuming workspace', () => {
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/types/src/index.ts', 'packages/eslint-config/index.js']) {
    assert.equal(planChecks([file]).workspaces.length, 4);
  }
});

test('documentation has no application checks; infrastructure selects its contracts', () => {
  assert.deepEqual(planChecks(['README.md']), { workspaces: [], commands: [] });
  assert.deepEqual(planChecks(['infra/firebase/cloudbuild-release.yaml']).workspaces, []);
  assert.equal(planChecks(['infra/firebase/cloudbuild-release.yaml', 'infra/firebase/verify-release.sh']).commands.length, 2);
  assert.equal(planChecks(['scripts/pre-push.mjs', '.githooks/pre-push']).commands.length, 1);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'siskop-hook-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repository = path.join(directory, 'repo');
  const remote = path.join(directory, 'remote.git');
  fs.mkdirSync(repository);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  // Nested hook tests must not inherit the caller repository's Git context.
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'hook-test@example.invalid');
  git('config', 'user.name', 'Hook Test');
  execFileSync('git', ['init', '--bare', remote], { env, stdio: 'ignore' });
  git('remote', 'add', 'origin', remote);
  for (const file of ['scripts/pre-push.mjs', 'scripts/install-git-hooks.mjs', '.githooks/pre-push']) {
    fs.mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(repository, file));
  }
  fs.chmodSync(path.join(repository, '.githooks/pre-push'), 0o755);
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ name: 'hook-test', private: true }));
  git('add', '.');
  git('commit', '-m', 'baseline');
  git('push', '-u', 'origin', 'main');
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const log = path.join(directory, 'calls.jsonl');
  fs.writeFileSync(path.join(bin, 'pnpm'), `#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(process.env.HOOK_COMMAND_LOG, JSON.stringify(process.argv.slice(2))+'\\n');\nif(process.env.HOOK_DB_LOG && process.env.DATABASE_URL){const u=new URL(process.env.DATABASE_URL);fs.appendFileSync(process.env.HOOK_DB_LOG,JSON.stringify({host:u.hostname,database:u.pathname})+'\\n');}\nif(process.env.HOOK_FAIL_TEST==='1' && process.argv.includes('test')) process.exit(7);\n`);
  // A .mjs entry point avoids relying on the test runner's Node version default.
  fs.renameSync(path.join(bin, 'pnpm'), path.join(bin, 'pnpm.mjs'));
  fs.chmodSync(path.join(bin, 'pnpm.mjs'), 0o755);
  fs.symlinkSync(path.join(bin, 'pnpm.mjs'), path.join(bin, 'pnpm'));
  fs.writeFileSync(path.join(bin, 'docker.mjs'), `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2);
fs.appendFileSync(process.env.HOOK_DOCKER_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='context') console.log(JSON.stringify([{Endpoints:{docker:{Host:'unix:///test/docker.sock'}}}]));
if(args[0]==='run') {if(process.env.HOOK_FAIL_DOCKER==='1')process.exit(1);console.log('test-container');}
if(args[0]==='port') console.log('127.0.0.1:43219');
`);
  fs.chmodSync(path.join(bin, 'docker.mjs'), 0o755);
  fs.symlinkSync(path.join(bin, 'docker.mjs'), path.join(bin, 'docker'));
  env.PATH = bin + path.delimiter + env.PATH;
  env.HOOK_COMMAND_LOG = log;
  env.HOOK_DOCKER_LOG = path.join(directory, 'docker.jsonl');
  env.HOOK_DB_LOG = path.join(directory, 'databases.jsonl');
  delete env.DOCKER_HOST;
  const install = () => spawnSync(process.execPath, ['scripts/install-git-hooks.mjs'], { cwd: repository, env, encoding: 'utf8' });
  const change = (file, content = 'changed') => {
    fs.mkdirSync(path.dirname(path.join(repository, file)), { recursive: true });
    fs.writeFileSync(path.join(repository, file), content);
    git('add', file); git('commit', '-m', `change ${file}`);
  };
  const push = () => spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/feature'], { cwd: repository, env, encoding: 'utf8' });
  return { repository, remote, env, git, install, change, push, log };
}

test('real git push runs lint/typechecks/tests before remote ref appears', t => {
  const f = fixture(t);
  assert.equal(f.install().status, 0);
  f.change('apps/frontend/src/example.ts');
  const result = f.push();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const calls = fs.readFileSync(f.log, 'utf8');
  assert.match(calls, /"lint","typecheck"/);
  assert.match(calls, /"@siskop\/frontend","test"/);
  assert.match(result.stdout + result.stderr, /SISKOP pre-push.*PASS/);
  assert.equal(execFileSync('git', ['--git-dir', f.remote, 'rev-parse', 'refs/heads/feature'], { encoding: 'utf8' }).trim(), f.git('rev-parse', 'HEAD'));
});

test('failed local test blocks actual remote update', t => {
  const f = fixture(t);
  assert.equal(f.install().status, 0);
  f.change('apps/frontend/src/example.ts');
  f.env.HOOK_FAIL_TEST = '1';
  const result = f.push();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Push blocked/);
  assert.equal(spawnSync('git', ['--git-dir', f.remote, 'show-ref', '--verify', '--quiet', 'refs/heads/feature']).status, 1);
});

test('uncommitted changes block checks against the wrong working tree', t => {
  const f = fixture(t); f.install(); f.change('apps/frontend/src/example.ts');
  fs.writeFileSync(path.join(f.repository, 'README.md'), 'uncommitted');
  assert.match(f.push().stderr, /Commit or stash/);
  assert.equal(fs.existsSync(f.log), false);
});

test('existing hook configuration is preserved', t => {
  const f = fixture(t); f.git('config', 'core.hooksPath', 'custom-hooks');
  assert.notEqual(f.install().status, 0);
  assert.equal(f.git('config', '--get', 'core.hooksPath'), 'custom-hooks');
});

test('existing standalone pre-push hook is preserved', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repository, '.git/hooks/pre-push'), '#!/bin/sh\nexit 0\n');
  assert.notEqual(f.install().status, 0);
});

test('pushing an unchecked branch commit is rejected', t => {
  const f = fixture(t); f.install();
  const old = f.git('rev-parse', 'HEAD');
  f.change('apps/frontend/src/example.ts');
  const result = spawnSync('git', ['push', 'origin', `${old}:refs/heads/old`], { cwd: f.repository, env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checked-out commit/);
});

test('backend migration and tests use only disposable DB and clean up after failure', t => {
  const f = fixture(t); f.install(); f.change('apps/backend/src/example.ts');
  f.env.DATABASE_URL = 'postgresql://fake:unused@production.example.invalid/live';
  f.env.HOOK_FAIL_TEST = '1';
  assert.notEqual(f.push().status, 0);
  const calls = fs.readFileSync(f.log, 'utf8');
  assert.match(calls, /"prisma","migrate","deploy"/);
  const databases = fs.readFileSync(f.env.HOOK_DB_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(databases.length >= 4);
  assert.ok(databases.every(row => row.host === '127.0.0.1' && row.database === '/siskop_prepush_test'));
  const docker = fs.readFileSync(f.env.HOOK_DOCKER_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const created = docker.find(args => args[0] === 'run');
  assert.ok(created.includes('127.0.0.1::5432'));
  const name = created[created.indexOf('--name') + 1];
  assert.deepEqual(docker.at(-1), ['rm', '-f', name]);
});

test('failed Docker creation never removes an existing container', t => {
  const f = fixture(t); f.install(); f.change('apps/backend/src/example.ts'); f.env.HOOK_FAIL_DOCKER = '1';
  assert.notEqual(f.push().status, 0);
  assert.doesNotMatch(fs.readFileSync(f.env.HOOK_DOCKER_LOG, 'utf8'), /"rm"/);
});

test('remote Docker endpoint is rejected before container creation', t => {
  const f = fixture(t); f.install(); f.change('apps/backend/src/example.ts'); f.env.DOCKER_HOST = 'ssh://remote.example.invalid';
  assert.notEqual(f.push().status, 0);
  assert.doesNotMatch(fs.readFileSync(f.env.HOOK_DOCKER_LOG, 'utf8'), /"run"/);
});
