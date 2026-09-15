import http from 'node:http';
import https from 'node:https';
import { createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const excluded = new Set(['host', 'connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'transfer-encoding', 'trailer', 'upgrade', 'te', 'forwarded']);

/** The upstream is fixed configuration, never a URL provided by the browser. */
export function createTenantWeb({ baseDomain, apiOrigin, secret, staticDir, production = true, release = {}, developmentHandler }) {
  if (!baseDomain || !secret || secret.length < 32) throw new Error('Tenant web configuration is incomplete');
  const upstream = new URL(apiOrigin);
  if (upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password ||
      (upstream.protocol !== 'https:' && (production || upstream.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(upstream.hostname)))) {
    throw new Error('Invalid API origin');
  }
  const transport = upstream.protocol === 'https:' ? https : http;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
    if (req.url?.split('?')[0] === '/release.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(release)); return; }
    // App Hosting's trusted edge sets X-Forwarded-Host. The API still requires
    // this server's signed assertion; browser-supplied assertion headers are stripped.
    const forwarded = production ? req.headers['x-forwarded-host'] : undefined;
    const host = String(forwarded ?? req.headers.host ?? '').toLowerCase();
    const hostname = host.split(':')[0];
    const slug = hostname?.endsWith(`.${baseDomain}`) ? hostname.slice(0, -(baseDomain.length + 1)) : '';
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) {
      res.writeHead(404); res.end('Workspace not found'); return;
    }
    const url = req.url ?? '/';
    if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) { res.writeHead(400); res.end('Invalid path'); return; }
    if (url.startsWith('/api/') || url.startsWith('/uploads/')) {
      const headers = {};
      const hopHeaders = new Set(String(req.headers.connection ?? '').toLowerCase().split(',').map(s => s.trim()));
      for (const [name, value] of Object.entries(req.headers)) {
        if (!excluded.has(name) && !hopHeaders.has(name) && !name.startsWith('x-forwarded-') && !name.startsWith('x-siskop-') && value !== undefined) headers[name] = value;
      }
      const time = String(Date.now());
      Object.assign(headers, { host: upstream.host, 'x-siskop-host': host, 'x-siskop-time': time,
        'x-siskop-signature': createHmac('sha256', secret).update([time, req.method, url, host].join('\n')).digest('base64url') });
      const proxy = transport.request({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port,
        path: url, method: req.method, headers, timeout: 30_000 }, (response) => {
        const resultHeaders = { ...response.headers, 'cache-control': 'private, no-store' };
        for (const name of excluded) delete resultHeaders[name];
        // Host-only cookies remain host-only. An upstream Domain attribute is
        // never widened to the parent tenant namespace.
        if (resultHeaders['set-cookie']) resultHeaders['set-cookie'] = resultHeaders['set-cookie'].map(cookie => cookie.replace(/;\s*Domain=[^;]+/ig, ''));
        res.writeHead(response.statusCode ?? 502, resultHeaders);
        response.pipe(res);
        response.on('error', () => res.destroy());
      });
      proxy.on('timeout', () => proxy.destroy());
      proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('API temporarily unavailable'); });
      req.on('aborted', () => proxy.destroy());
      req.pipe(proxy);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (!production && developmentHandler) { developmentHandler(req, res, () => { res.writeHead(404); res.end(); }); return; }
    try {
      const pathname = decodeURIComponent(url.split('?')[0]);
      const root = path.resolve(staticDir);
      const candidate = path.resolve(root, '.' + pathname);
      if ((candidate !== root && !candidate.startsWith(root + path.sep)) || pathname.split('/').some(part => part.startsWith('.'))) {
        res.writeHead(404); res.end(); return;
      }
      let file = candidate;
      let metadata = await stat(file).catch(() => null);
      if (!metadata?.isFile()) {
        if (path.extname(pathname)) { res.writeHead(404); res.end(); return; }
        file = path.join(root, 'index.html'); metadata = await stat(file);
      }
      res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
      res.setHeader('Content-Length', metadata.size);
      if (pathname.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file); stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8'));
  const server = createTenantWeb({ baseDomain: process.env.TENANT_BASE_DOMAIN, apiOrigin: process.env.TENANT_API_ORIGIN,
    secret: process.env.TENANT_GATEWAY_SECRET, production: process.env.NODE_ENV === 'production',
    staticDir: process.env.TENANT_STATIC_DIR ?? 'apps/frontend/dist',
    release });
  server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
