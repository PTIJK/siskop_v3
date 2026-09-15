import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareJobs, optionalResource, jobs } from './scheduler.mjs';

const origin = 'https://siskop-staging-api-example.a.run.app';
const token = 'test-only-secret';
function fakeCloud(existing = false) {
  const resources = new Map();
  const calls = [];
  for (const job of jobs) if (existing) resources.set(job.id, { state: 'ENABLED', name: job.id });
  return { calls, resources, async request(method, url, body) {
    calls.push({ method, url, body });
    const id = url.split('/').pop().split(/[?:]/)[0];
    if (method === 'GET') {
      if (!resources.has(id)) throw Object.assign(new Error('not found'), { status: 404 });
      return resources.get(id);
    }
    if (url.endsWith(':pause')) { const job = resources.get(id); job.state = 'PAUSED'; return job; }
    if (method === 'POST' && url.endsWith('/jobs')) {
      const job = { ...body, state: 'ENABLED' }; resources.set(body.name.split('/').pop(), job); return job;
    }
    if (method === 'PATCH') {
      assert.equal(resources.get(id).state, 'PAUSED', 'must pause before changing to a mutating target');
      const job = { ...body, state: 'PAUSED' }; resources.set(id, job); return job;
    }
    throw new Error(`Unexpected method ${method}`);
  } };
}
test('new jobs start with a harmless GET, then pause before configuring real work', async () => {
  const cloud = fakeCloud();
  await prepareJobs(cloud, origin, token);
  const creates = cloud.calls.filter(call => call.method === 'POST' && call.url.endsWith('/jobs'));
  assert.equal(creates.length, 2);
  for (const call of creates) {
    assert.equal(call.body.httpTarget.httpMethod, 'GET');
    assert.equal(call.body.httpTarget.uri, origin + '/api/scheduler/status');
  }
  for (const spec of jobs) {
    const job = cloud.resources.get(spec.id);
    assert.equal(job.state, 'PAUSED');
    assert.equal(job.schedule, spec.schedule);
    assert.equal(job.httpTarget.uri, origin + spec.path);
    assert.equal(job.httpTarget.httpMethod, 'POST');
    assert.equal(job.httpTarget.oidcToken.audience, origin);
    assert.equal(job.httpTarget.headers['x-scheduler-token'], token);
    assert.equal(job.retryConfig.retryCount, 3);
  }
});
test('rerunning setup pauses and updates existing jobs without creating duplicates', async () => {
  const cloud = fakeCloud(true);
  await prepareJobs(cloud, origin, token);
  await prepareJobs(cloud, origin, token);
  assert.equal(cloud.calls.filter(call => call.url.endsWith('/jobs') && call.method === 'POST').length, 0);
  assert.equal(cloud.calls.filter(call => call.url.endsWith(':pause')).length, 2);
  assert.equal(cloud.calls.filter(call => call.method === 'PATCH').length, 4);
  assert.equal(cloud.resources.size, 2);
});
test('authorization and network errors never masquerade as missing resources', async () => {
  for (const status of [403, 500, undefined]) {
    const error = Object.assign(new Error('read failed'), { status });
    await assert.rejects(optionalResource({ request: async () => { throw error; } }, 'https://example.invalid'), e => e === error);
  }
});
test('pause failure leaves a newly created job read-only', async () => {
  const cloud = fakeCloud();
  const request = cloud.request.bind(cloud);
  cloud.request = async (...args) => { if (args[1].endsWith(':pause')) throw new Error('pause denied'); return request(...args); };
  await assert.rejects(prepareJobs(cloud, origin, token), /pause denied/);
  assert.equal(cloud.resources.get(jobs[0].id).httpTarget.httpMethod, 'GET');
  assert.equal(cloud.calls.filter(call => call.method === 'PATCH').length, 0);
});
test('an unexpected service origin is rejected before transmitting the shared secret', async () => {
  const cloud = fakeCloud();
  for (const url of ['http://example.com', origin + '/path', 'https://other-service.a.run.app', origin + '?foo=bar']) {
    await assert.rejects(prepareJobs(cloud, url, token), /origin/);
  }
  assert.equal(cloud.calls.length, 0);
});
