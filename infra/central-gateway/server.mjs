import http from 'node:http';
import https from 'node:https';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const excluded = new Set(['host', 'connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'transfer-encoding', 'trailer', 'upgrade', 'te', 'forwarded']);

/** A fixed upstream; no business logic, SQL, credentials or automatic retries. */
export function createCentralGateway({ apiOrigin, secret, development = false }) {
  if (!secret || secret.length < 32) throw new Error('Gateway secret is required');
  const origin = new URL(apiOrigin);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(development && origin.protocol === 'http:' && origin.hostname === '127.0.0.1'))) {
    throw new Error('Invalid fixed API origin');
  }
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.url === '/health') { res.end('ok'); return; }
    const url = req.url ?? '';
    if ((!url.startsWith('/api/') && !url.startsWith('/uploads/')) || url.includes('\\') || /[\r\n]/.test(url)) {
      res.writeHead(404); res.end(); return;
    }
    const headers = {};
    const hopHeaders = new Set(String(req.headers.connection ?? '').toLowerCase().split(',').map(x => x.trim()));
    for (const [name, value] of Object.entries(req.headers)) {
      if (!excluded.has(name) && !hopHeaders.has(name) && !name.startsWith('x-forwarded-') && !name.startsWith('x-siskop-') && value !== undefined) headers[name] = value;
    }
    const time = String(Date.now());
    headers.host = origin.host;
    headers['x-siskop-central-time'] = time;
    headers['x-siskop-central-signature'] = createHmac('sha256', secret).update(['central', time, req.method, url].join('\n')).digest('base64url');
    const upstream = (origin.protocol === 'https:' ? https : http).request({
      protocol: origin.protocol, hostname: origin.hostname, port: origin.port,
      method: req.method, path: url, headers, timeout: 60_000
    }, response => {
      const output = { ...response.headers, 'cache-control': 'private, no-store' };
      const responseHopHeaders = new Set(String(response.headers.connection ?? '').toLowerCase().split(',').map(x => x.trim()));
      for (const name of Object.keys(output)) if (excluded.has(name) || responseHopHeaders.has(name)) delete output[name];
      if (output['set-cookie']) output['set-cookie'] = output['set-cookie'].map(cookie => cookie.replace(/;\s*Domain=[^;]+/ig, ''));
      res.writeHead(response.statusCode ?? 502, output);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 3 * 1024 * 1024) { upstream.destroy(); if (!res.headersSent) res.writeHead(413); res.end(); }
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); if (!res.writableEnded) res.end('API temporarily unavailable'); });
    req.pipe(upstream);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createCentralGateway({ apiOrigin: process.env.SISKOP_API_ORIGIN, secret: process.env.CENTRAL_GATEWAY_SECRET });
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
