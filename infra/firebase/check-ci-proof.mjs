import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const policy = JSON.parse(fs.readFileSync(new URL('./ci-verification-policy.json', import.meta.url), 'utf8'));
const sha = /^[a-f0-9]{40}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

export function verificationMode(proof, env, now = Date.now()) {
  if (!proof || proof.version !== policy.version || !['full', 'reuse-ci'].includes(proof.mode) ||
      proof.commit !== (env.RELEASE_COMMIT ?? '') || proof.buildId !== (env.RELEASE_BUILD_ID ?? '')) {
    throw new Error('Verification evidence does not belong to this build');
  }
  if (proof.mode === 'full') return 'full';
  const age = (now - Date.parse(proof.completedAt)) / 1000;
  if (env.RELEASE_DEPLOY !== 'true' || env.RELEASE_BRANCH !== 'main' || env.RELEASE_VERIFICATION !== 'reuse-ci' ||
      !sha.test(proof.commit) || !uuid.test(proof.buildId) || !sha.test(proof.verifiedCommit) || !sha.test(proof.tree) ||
      proof.workflowBlob !== policy.workflowBlob || !Number.isSafeInteger(proof.runId) || proof.runId <= 0 ||
      !Number.isFinite(age) || age < -300 || age > policy.maxAgeSeconds) {
    throw new Error('CI evidence is invalid or stale; full verification is required');
  }
  return 'reuse-ci';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const proof = JSON.parse(fs.readFileSync('.release/verification.json', 'utf8'));
  console.log(verificationMode(proof, process.env));
}
