import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTenantWeb } from './server.mjs';
const secret = 'isolated-gateway-test-secret-32-or-more';
const baseDomain = 'koperasi.localhost';
const host = 'alpha.' + baseDomain;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
function send(port, url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: url, method, headers: { host, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
}
test('tenant gateway streams requests, authenticates its host, preserves cookies and isolates static paths', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'siskop-tenant-web-'));
  const received = [];
  const upstream = createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      received.push({ headers: req.headers, method: req.method, path: req.url, body: Buffer.concat(chunks).toString() });
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Set-Cookie', ['siskop_refresh_token=fixture; Path=/api/auth; HttpOnly; Secure; SameSite=Strict; Domain=.koperasi.localhost', 'another=fixture; Path=/']);
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const upstreamPort = await listen(upstream);
  const server = createTenantWeb({ baseDomain, apiOrigin: `http://127.0.0.1:${upstreamPort}`, secret, staticDir: directory, production: false, release: { commit: 'fixture' } });
  const port = await listen(server);
  try {
    await writeFile(path.join(directory, 'index.html'), '<html>SISKOP tenant app</html>');
    await mkdir(path.join(directory, 'member-app'));
    await writeFile(path.join(directory, 'member-app', 'index.html'), '<html>Portal Anggota</html>');
    await mkdir(path.join(directory, 'assets')); await writeFile(path.join(directory, 'assets', 'app.js'), '/* asset */');
    assert.equal((await send(port, '/')).status, 200);
    assert.match((await send(port, '/dashboard')).text, /SISKOP tenant app/);
    assert.match((await send(port, '/anggota/login')).text, /Portal Anggota/);
    assert.match((await send(port, '/anggota/simpanan/fixture')).text, /Portal Anggota/);
    assert.match((await send(port, '/anggota')).text, /Portal Anggota/);
    assert.match((await send(port, '/assets/app.js')).headers['cache-control'], /immutable/);
    assert.equal((await send(port, '/.env')).status, 404);
    assert.equal((await send(port, '/%2e%2e/package.json')).status, 404);
    assert.equal((await send(port, '//evil.test')).status, 400);
    assert.equal((await send(port, '/dashboard', { method: 'POST' })).status, 405);
    assert.equal((await send(port, '/dashboard', { headers: { host: 'a.b.' + baseDomain } })).status, 404);
    const response = await send(port, '/api/example?sort=name', { method: 'POST', headers: { 'x-siskop-host': 'forged', 'x-siskop-signature': 'forged', 'x-forwarded-host': 'forged', 'content-type': 'multipart/form-data; boundary=test', cookie: 'siskop_refresh_token=test-cookie' }, body: 'fixture multipart bytes' });
    assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['set-cookie'].length, 2); assert.ok(response.headers['set-cookie'].every(c => !c.includes('Domain=')));
    const last = received.at(-1); assert.equal(last.body, 'fixture multipart bytes'); assert.equal(last.path, '/api/example?sort=name');
    assert.equal(last.headers['x-siskop-host'], host); assert.equal(last.headers['x-forwarded-host'], undefined);
    assert.equal(last.headers.cookie, 'siskop_refresh_token=test-cookie');
    const expected = createHmac('sha256', secret).update([last.headers['x-siskop-time'], 'POST', last.path, host].join('\n')).digest('base64url');
    assert.equal(last.headers['x-siskop-signature'], expected);
    assert.equal(JSON.parse((await send(port, '/release.json')).text).commit, 'fixture');
  } finally { await close(server); await close(upstream); await rm(directory, { recursive: true, force: true }); }
});
test('production rejects unencrypted or caller-controlled upstream configuration', () => {
  for (const apiOrigin of ['http://evil.test', 'https://api.example.com/path', 'https://user:password@api.example.com']) {
    assert.throws(() => createTenantWeb({ apiOrigin, baseDomain, secret, staticDir: '.' }));
  }
});
test('direct handoff preserves form Origin, navigation metadata, cookies and the dashboard redirect', async () => {
  let received;
  const upstream = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received = { headers: req.headers, body: Buffer.concat(chunks).toString() };
      res.writeHead(303, {
        location: '/dashboard?handoff=1',
        'set-cookie': 'siskop_refresh_token=fixture; Path=/api/auth; HttpOnly; Secure; SameSite=Strict',
        'referrer-policy': 'no-referrer'
      });
      res.end();
    });
  });
  const upstreamPort = await listen(upstream);
  const server = createTenantWeb({ baseDomain, apiOrigin: `http://127.0.0.1:${upstreamPort}`, secret, staticDir: '.', production: false });
  const port = await listen(server);
  try {
    const response = await send(port, '/api/tenant-access/accept', {
      method: 'POST',
      headers: { origin: 'https://siskop-d0f8c.web.app', 'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
      body: 'attempt=fixture&code=synthetic-ticket'
    });
    assert.equal(received.headers.origin, 'https://siskop-d0f8c.web.app');
    assert.equal(received.headers['sec-fetch-mode'], 'navigate');
    assert.equal(received.headers['sec-fetch-dest'], 'document');
    assert.equal(received.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(received.body, 'attempt=fixture&code=synthetic-ticket');
    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/dashboard?handoff=1');
    assert.match(response.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
    assert.equal(response.headers['cache-control'], 'private, no-store');
  } finally { await close(server); await close(upstream); }
});
