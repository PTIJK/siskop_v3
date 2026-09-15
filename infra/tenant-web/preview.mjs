import { createServer } from '../../apps/frontend/node_modules/vite/dist/node/index.js';
import { createTenantWeb } from './server.mjs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../../apps/frontend', import.meta.url)));
Object.assign(process.env, {
  VITE_PUBLIC_APP_URL: 'http://localhost:3050', VITE_FIREBASE_PROJECT_ID: 'demo-siskop-tenants', VITE_FIREBASE_API_KEY: 'local-emulator-only',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-siskop-tenants.firebaseapp.com', VITE_FIREBASE_APP_ID: 'local-emulator-only',
  VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9109', VITE_TENANT_BASE_DOMAIN: 'koperasi.localhost'
});
const vite = await createServer({ server: { middlewareMode: true, hmr: false } });
const server = createTenantWeb({ baseDomain: 'koperasi.localhost', apiOrigin: 'http://127.0.0.1:3051',
  secret: 'local-tenant-preview-key-32-characters-only', production: false, staticDir: fileURLToPath(new URL('../../apps/frontend/dist', import.meta.url)), developmentCentralHost: 'localhost',
  developmentHandler: vite.middlewares });
server.listen(3050, '0.0.0.0', () => console.info('Tenant preview: http://alpha-preview.koperasi.localhost:3050/login'));
process.on('SIGTERM', () => { server.close(); void vite.close(); });
