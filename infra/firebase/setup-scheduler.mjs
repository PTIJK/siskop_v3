#!/usr/bin/env node
// Run once BEFORE merging the scheduler PR. Leaves both jobs paused. The
// coordinated main release activates them after checking the serving revision.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { project, region, service, invoker, optionalResource, prepareJobs } from './scheduler.mjs';

const runtime = `${service}@${project}.iam.gserviceaccount.com`;
const builder = `siskop-cloud-build@${project}.iam.gserviceaccount.com`;
function command(args, input) {
  const result = spawnSync(process.env.GCLOUD_BIN || 'gcloud', [...args, `--project=${project}`, '--account=yudith.octo@gmail.com', '--quiet'], { input, encoding: 'utf8' });
  // Never include arguments, stderr, request bodies or provider responses that
  // might echo credentials. Secret values only travel over stdin/HTTPS.
  if (result.error || result.status !== 0) throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed (exit ${result.status})`);
  return result.stdout.trim();
}
const cloud = { async request(method, url, body) {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(60_000), headers: {
    Authorization: `Bearer ${command(['auth', 'print-access-token'])}`,
    'Content-Type': 'application/json', 'x-goog-user-project': project
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw Object.assign(new Error(`Cloud API HTTP ${response.status} for ${method} ${new URL(url).pathname}`), { status: response.status });
  return response.status === 204 ? null : response.json();
} };

async function main() {
  command(['services', 'enable', 'cloudscheduler.googleapis.com']);
  const secretUrl = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/SCHEDULER_SECRET`;
  if (!await optionalResource(cloud, secretUrl)) command(['secrets', 'create', 'SCHEDULER_SECRET', '--replication-policy=automatic']);
  const versions = await cloud.request('GET', secretUrl + '/versions?pageSize=1');
  if (!versions.versions?.length) command(['secrets', 'versions', 'add', 'SCHEDULER_SECRET', '--data-file=-'], randomBytes(32).toString('hex'));
  // deploy-api.sh pins version 1. Never pick "latest" or silently rotate an
  // existing secret and leave the API/jobs using different credentials.
  const version = await cloud.request('GET', secretUrl + '/versions/1');
  if (version.state !== 'ENABLED') throw new Error('SCHEDULER_SECRET version 1 must be enabled; reconcile the deployment binding before retrying');
  command(['secrets', 'add-iam-policy-binding', 'SCHEDULER_SECRET', `--member=serviceAccount:${runtime}`, '--role=roles/secretmanager.secretAccessor']);

  if (!await optionalResource(cloud, `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${invoker}`)) {
    command(['iam', 'service-accounts', 'create', 'siskop-scheduler-invoker', '--display-name=SISKOP scheduled API invoker']);
  }
  command(['run', 'services', 'add-iam-policy-binding', service, `--region=${region}`, `--member=serviceAccount:${invoker}`, '--role=roles/run.invoker']);

  const role = 'siskopSchedulerActivator';
  const roleExists = await optionalResource(cloud, `https://iam.googleapis.com/v1/projects/${project}/roles/${role}`);
  command(['iam', 'roles', roleExists ? 'update' : 'create', role, '--title=SISKOP scheduler release activation', '--permissions=cloudscheduler.jobs.get,cloudscheduler.jobs.enable', '--stage=GA']);
  command(['projects', 'add-iam-policy-binding', project, `--member=serviceAccount:${builder}`, `--role=projects/${project}/roles/${role}`, '--condition=None']);

  const origin = command(['run', 'services', 'describe', service, `--region=${region}`, '--format=value(status.url)']);
  const token = command(['secrets', 'versions', 'access', '1', '--secret=SCHEDULER_SECRET']);
  await prepareJobs(cloud, origin, token);
  console.log('Both scheduled jobs are configured and PAUSED. No API revision or traffic was changed. Merge the tested PR into main; its successful release will activate both jobs.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
