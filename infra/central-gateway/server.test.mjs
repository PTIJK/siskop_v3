import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dns from 'node:dns';
import { createHmac } from 'node:crypto';
import { createCentralGateway } from './server.mjs';

const secret = 'central-gateway-test-key-32-characters';
const servers = [];
async function listen(server) {
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
});

test('requires a fixed HTTPS origin and a server-only signing secret', () => {
  for (const apiOrigin of ['http://example.com', 'https://example.com/path', 'https://user:pass@example.com', 'https://example.com/?next=evil'])
    assert.throws(() => createCentralGateway({ apiOrigin, secret }));
  assert.throws(() => createCentralGateway({ apiOrigin: 'https://example.com', secret: '' }));
});

test('signs the complete request, streams its body and preserves response cookies/status', async () => {
  let received;
  const target = await listen(http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { headers: req.headers, body: Buffer.concat(chunks).toString(), url: req.url, method: req.method };
    res.writeHead(201, { 'set-cookie': ['__session=abc; Path=/api/auth; HttpOnly; Secure; SameSite=Strict; Domain=example.com'], 'content-type': 'application/json' });
    res.end('{"ok":true}');
  }));
  const origin = await listen(createCentralGateway({ apiOrigin: target, secret, development: true }));
  const response = await fetch(origin + '/api/auth/login?x=1', { method: 'POST', body: 'payload', headers: {
    'x-siskop-host': 'attacker', 'x-siskop-central-signature': 'forged', 'x-forwarded-host': 'attacker', cookie: '__session=incoming'
  } });
  assert.equal(response.status, 201);
  assert.equal(await response.text(), '{"ok":true}');
  assert.equal(received.body, 'payload');
  assert.equal(received.headers['x-siskop-host'], undefined);
  assert.equal(received.headers['x-forwarded-host'], undefined);
  assert.equal(received.headers.cookie, '__session=incoming');
  assert.equal(received.headers['x-siskop-central-signature'], createHmac('sha256', secret)
    .update(['central', received.headers['x-siskop-central-time'], 'POST', '/api/auth/login?x=1'].join('\n')).digest('base64url'));
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /Domain=/i);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('rejects arbitrary destinations and unsupported paths before forwarding', async () => {
  let calls = 0;
  const target = await listen(http.createServer((_req, res) => { calls++; res.end('unexpected'); }));
  const origin = await listen(createCentralGateway({ apiOrigin: target, secret, development: true }));
  for (const path of ['/https://evil.example', '/admin', '/']) assert.equal((await fetch(origin + path)).status, 404);
  assert.equal(calls, 0);
});

test('does not retry a failed mutation', async () => {
  let calls = 0;
  const target = await listen(http.createServer((req) => { calls++; req.socket.destroy(); }));
  const origin = await listen(createCentralGateway({ apiOrigin: target, secret, development: true }));
  assert.equal((await fetch(origin + '/api/loans', { method: 'POST', body: '{}' })).status, 502);
  assert.equal(calls, 1);
});

test('reaches the IPv4 ingress when a dual-stack DNS lookup times out', async t => {
  let connections = 0;
  const target = http.createServer();
  target.on('connection', () => connections++);
  target.on('clientError', (_error, socket) => socket.destroy());
  await listen(target);
  const origin = await listen(createCentralGateway({ apiOrigin: `https://ingress.invalid:${target.address().port}`, secret }));
  t.mock.method(dns, 'lookup', (_hostname, options, callback) => {
    if (options.family !== 4) {
      process.nextTick(callback, Object.assign(new Error('AAAA response lost'), { code: 'EAI_AGAIN' }));
    } else {
      process.nextTick(callback, null, '127.0.0.1', 4);
    }
  });
  // The plaintext fixture rejects TLS after accepting the TCP connection.
  assert.equal((await fetch(origin + '/api/public/pricing')).status, 502);
  assert.equal(connections, 1);
});

test('records slow upstream stages without logging request or response data', async t => {
  const messages = [];
  t.mock.method(console, 'warn', message => messages.push(JSON.parse(message)));
  const target = await listen(http.createServer((_req, res) => {
    setTimeout(() => res.end('private-response'), 1050);
  }));
  const origin = await listen(createCentralGateway({ apiOrigin: target, secret, development: true }));
  const response = await fetch(origin + '/api/auth/login?token=private-query', {
    method: 'POST', body: 'private-body', headers: { authorization: 'Bearer private-token' }
  });
  assert.equal(await response.text(), 'private-response');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].event, 'gateway_slow_request');
  assert.equal(messages[0].status, 200);
  assert.ok(messages[0].headersMs >= 1000);
  assert.ok(messages[0].totalMs >= messages[0].headersMs);
  assert.doesNotMatch(JSON.stringify(messages), /private-|login|Bearer|central-gateway-test-key/);
});
