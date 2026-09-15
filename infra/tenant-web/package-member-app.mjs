import { cp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const source = new URL('apps/mobile/dist/', root);
const html = await readFile(new URL('index.html', source), 'utf8');
if (!html.includes('/member-app/assets/')) throw new Error('Build the mobile app with its production asset base first.');
await cp(fileURLToPath(source), fileURLToPath(new URL('apps/frontend/dist/member-app/', root)), { recursive: true });
