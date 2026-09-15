import { randomBytes } from 'node:crypto';
import { cloudRequest, project } from './cloud.mjs';
const runtime = `siskop-staging-api@${project}.iam.gserviceaccount.com`;
const apphosting = `firebase-app-hosting-compute@${project}.iam.gserviceaccount.com`;
const build = `siskop-cloud-build@${project}.iam.gserviceaccount.com`;
async function policyBinding(url, role, member, projectPolicy = false) {
  const policy = projectPolicy || url.startsWith('https://iam.googleapis.com/')
    ? await cloudRequest('POST', url + ':getIamPolicy', {}) : await cloudRequest('GET', url + ':getIamPolicy');
  policy.bindings ??= [];
  let binding = policy.bindings.find(item => item.role === role && !item.condition);
  if (!binding) { binding = { role, members: [] }; policy.bindings.push(binding); }
  if (binding.members.includes(member)) return;
  binding.members.push(member);
  await cloudRequest('POST', url + ':setIamPolicy', { policy });
}
const secretUrl = `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/TENANT_GATEWAY_SECRET`;
try { await cloudRequest('GET', secretUrl); }
catch (error) {
  if (error.status !== 404) throw error;
  await cloudRequest('POST', `https://secretmanager.googleapis.com/v1/projects/${project}/secrets?secretId=TENANT_GATEWAY_SECRET`, { replication: { automatic: {} } });
}
const versions = await cloudRequest('GET', secretUrl + '/versions');
if (!versions.versions?.some(version => version.state === 'ENABLED')) {
  const key = randomBytes(48).toString('base64url');
  await cloudRequest('POST', secretUrl + ':addVersion', { payload: { data: Buffer.from(key).toString('base64') } });
}
for (const account of [runtime, apphosting]) await policyBinding(secretUrl, 'roles/secretmanager.secretAccessor', `serviceAccount:${account}`);

// Minimal Firebase user-management permissions; no auth-provider configuration access.
const roleId = 'siskopIdentityProvisioner';
const roleUrl = `https://iam.googleapis.com/v1/projects/${project}/roles/${roleId}`;
const permissions = ['firebaseauth.users.create', 'firebaseauth.users.delete', 'firebaseauth.users.get'];
const predefined = await cloudRequest('GET', 'https://iam.googleapis.com/v1/roles/firebaseauth.admin');
if (!permissions.every(permission => predefined.includedPermissions.includes(permission))) throw new Error('Firebase permission definitions changed');
try { await cloudRequest('GET', roleUrl); }
catch (error) {
  if (error.status !== 404) throw error;
  await cloudRequest('POST', `https://iam.googleapis.com/v1/projects/${project}/roles`, { roleId, role: { title: 'SISKOP identity provisioner', description: 'Create staff identities and reconcile abandoned owned accounts', stage: 'GA', includedPermissions: permissions } });
}
const projectUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
await policyBinding(projectUrl, `projects/${project}/roles/${roleId}`, `serviceAccount:${runtime}`, true);
await policyBinding(projectUrl, 'roles/firebaseapphosting.admin', `serviceAccount:${build}`, true);
await policyBinding(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${apphosting}`, 'roles/iam.serviceAccountUser', `serviceAccount:${build}`);

// Prepare the CLI source bucket once so CI needs no bucket-creation permission.
const sourceBucket = 'firebaseapphosting-sources-866351101735-asia-southeast1';
const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${sourceBucket}`;
try { await cloudRequest('GET', bucketUrl); }
catch (error) {
  if (error.status !== 404) throw error;
  await cloudRequest('POST', `https://storage.googleapis.com/storage/v1/b?project=${project}`, {
    name: sourceBucket, location: 'ASIA-SOUTHEAST1',
    labels: { 'apphosting-source-asia-southeast1': 'true' },
    iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' },
    lifecycle: { rule: [{ action: { type: 'Delete' }, condition: { age: 30 } }] }
  });
}
const discoveryRole = 'siskopAppHostingSourceDiscovery';
try { await cloudRequest('GET', `https://iam.googleapis.com/v1/projects/${project}/roles/${discoveryRole}`); }
catch (error) {
  if (error.status !== 404) throw error;
  await cloudRequest('POST', `https://iam.googleapis.com/v1/projects/${project}/roles`, { roleId: discoveryRole, role: {
    title: 'SISKOP App Hosting source discovery', stage: 'GA', includedPermissions: ['storage.buckets.list']
  } });
}
await policyBinding(projectUrl, `projects/${project}/roles/${discoveryRole}`, `serviceAccount:${build}`, true);
const bucketPolicy = await cloudRequest('GET', bucketUrl + '/iam');
bucketPolicy.bindings ??= [];
for (const [role, member] of [
  ['roles/storage.objectUser', `serviceAccount:${build}`],
  ['roles/storage.objectViewer', 'serviceAccount:service-866351101735@gcp-sa-firebaseapphosting.iam.gserviceaccount.com']
]) {
  let binding = bucketPolicy.bindings.find(item => item.role === role && !item.condition);
  if (!binding) { binding = { role, members: [] }; bucketPolicy.bindings.push(binding); }
  if (!binding.members.includes(member)) binding.members.push(member);
}
await cloudRequest('PUT', bucketUrl + '/iam', bucketPolicy);

// Parent-namespace authorization covers tenant web origins; OAuth handler stays fixed.
const authUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
const config = await cloudRequest('GET', authUrl);
const namespace = 'koperasi.inovasijayakarsa.id';
if (!config.authorizedDomains.includes(namespace)) await cloudRequest('PATCH', authUrl + '?updateMask=authorizedDomains', { authorizedDomains: [...config.authorizedDomains, namespace] });
console.log(JSON.stringify({ gatewaySecret: 'configured; value never displayed', runtimeIdentityRole: roleId, apphostingDeploymentAccess: 'configured', sourceBucket, firebaseAuthorizedNamespace: namespace }));
