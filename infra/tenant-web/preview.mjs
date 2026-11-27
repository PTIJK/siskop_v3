import { createServer } from '../../apps/frontend/node_modules/vite/dist/node/index.js';
import { createTenantWeb } from './server.mjs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../../apps/frontend', import.meta.url)));
const local = process.argv.includes('--local');
if (!local) Object.assign(process.env, {
  VITE_PUBLIC_APP_URL: 'http://localhost:3050', VITE_FIREBASE_PROJECT_ID: 'demo-siskop-tenants', VITE_FIREBASE_API_KEY: 'local-emulator-only',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-siskop-tenants.firebaseapp.com', VITE_FIREBASE_APP_ID: 'local-emulator-only',
  VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9109', VITE_TENANT_BASE_DOMAIN: 'koperasi.localhost'
});
const workspace = local ? {
  baseDomain: process.env.TENANT_BASE_DOMAIN,
  port: Number(process.env.TENANT_DEV_PORT),
  backendPort: Number(process.env.PORT),
  secret: process.env.TENANT_GATEWAY_SECRET
} : { baseDomain: 'koperasi.localhost', port: 3050, backendPort: 3051, secret: 'local-tenant-preview-key-32-characters-only' };
if (local && (!workspace.baseDomain?.endsWith('.localhost') || !workspace.port || !workspace.backendPort ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:'))) throw new Error('Local tenant configuration is incomplete.');
const vite = await createServer({ server: { middlewareMode: true, hmr: false } });
const server = createTenantWeb({ baseDomain: workspace.baseDomain, apiOrigin: 'http://127.0.0.1:' + workspace.backendPort,
  secret: workspace.secret, production: false, staticDir: fileURLToPath(new URL('../../apps/frontend/dist', import.meta.url)), developmentCentralHost: 'localhost',
  developmentHandler: vite.middlewares });
server.listen(workspace.port, local ? '127.0.0.1' : '0.0.0.0', () => console.info('Tenant preview: http://localhost:' + workspace.port));
process.on('SIGTERM', () => { server.close(); void vite.close(); });
