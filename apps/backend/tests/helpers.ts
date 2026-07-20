import request from 'supertest';
import app from '../src/app';

export const api = request(app);

export const DEMO_HOST = 'demo.localhost';

/** Extract name=value pairs from Set-Cookie response headers */
function parseCookies(setCookieHeader: unknown): string {
  const raw = setCookieHeader as string[] | string | undefined;
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : [raw];
  // Each entry looks like "name=value; HttpOnly; Max-Age=xxx; ..."
  // We only want the "name=value" part for the Cookie request header
  return arr.map((c) => c.split(';')[0]).join('; ');
}

/** Login as the seed admin and return cookies string */
export async function loginAsAdmin(): Promise<string> {
  const res = await api
    .post('/api/auth/login')
    .set('Host', DEMO_HOST)
    .send({ email: 'admin@demo.com', password: 'Admin123!' });

  if (res.status !== 200) throw new Error(`Login failed: ${JSON.stringify(res.body)}`);

  return parseCookies(res.headers['set-cookie']);
}
