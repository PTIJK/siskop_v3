import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verificationMode } from './check-ci-proof.mjs';

const policy = JSON.parse(fs.readFileSync(new URL('./ci-verification-policy.json', import.meta.url), 'utf8'));
const now = Date.UTC(2026, 9, 28, 12);
const env = { RELEASE_COMMIT: 'a'.repeat(40), RELEASE_BUILD_ID: '12345678-1234-1234-1234-123456789abc',
  RELEASE_DEPLOY: 'true', RELEASE_BRANCH: 'main', RELEASE_VERIFICATION: 'reuse-ci' };
const proof = { version: 1, mode: 'reuse-ci', commit: env.RELEASE_COMMIT, buildId: env.RELEASE_BUILD_ID,
  verifiedCommit: 'b'.repeat(40), tree: 'c'.repeat(40), runId: 7, workflowBlob: policy.workflowBlob,
  completedAt: new Date(now - 60_000).toISOString() };

test('only build-specific, fresh CI evidence enables reuse', () => {
  assert.equal(verificationMode(proof, env, now), 'reuse-ci');
});
test('the full-verification decision never requires reusable CI evidence', () => {
  assert.equal(verificationMode({ version: 1, mode: 'full', commit: env.RELEASE_COMMIT, buildId: env.RELEASE_BUILD_ID }, env, now), 'full');
});
test('stale, unrelated or malformed evidence cannot skip tests', () => {
  for (const change of [{ version: 2 }, { mode: 'skip' }, { commit: 'd'.repeat(40) }, { buildId: 'different' },
    { verifiedCommit: '' }, { tree: '' }, { workflowBlob: 'e'.repeat(40) }, { runId: 0 }, { runId: '7' },
    { completedAt: 'invalid' }, { completedAt: new Date(now - 2 * 86400_000).toISOString() },
    { completedAt: new Date(now + 3600_000).toISOString() }]) {
    assert.throws(() => verificationMode({ ...proof, ...change }, env, now));
  }
});
test('manual verification and non-main builds cannot reuse a proof', () => {
  for (const change of [{ RELEASE_DEPLOY: 'false' }, { RELEASE_BRANCH: 'feature/test' }, { RELEASE_VERIFICATION: 'full' }]) {
    assert.throws(() => verificationMode(proof, { ...env, ...change }, now));
  }
});
