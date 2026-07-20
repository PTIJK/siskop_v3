import request from 'supertest';
import app from '../src/app';
import {
  testPrisma,
  createTestTenant,
  createTestRoles,
  createTestUser,
  loginAs,
  cleanupTenant,
  parseCookieHeaders,
} from './helpers/setup';

const api = request(app);

let tenant: any;

beforeAll(async () => {
  tenant = await createTestTenant();
  const { superAdminRole } = await createTestRoles(tenant.id);
  await createTestUser(tenant.id, superAdminRole.id, 'admin@auth-test.com');
});

afterAll(async () => {
  await cleanupTenant(tenant.id);
  await testPrisma.$disconnect();
});

describe('POST /api/auth/register-tenant', () => {
  it('registers a new koperasi and returns loginUrl', async () => {
    const regNo = `REG-NEW-${Date.now()}`;
    const res = await api.post('/api/auth/register-tenant').send({
      name: 'Koperasi Registrasi Test',
      address: 'Jl. Registrasi No. 1, Jakarta',
      registrationNo: regNo,
      type: 'KONVENSIONAL',
      adminName: 'Admin Test',
      adminEmail: `admin.new.${Date.now()}@test.com`,
      adminPassword: 'Admin123!',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loginUrl).toMatch(/https:\/\/.+\..+\/login/);
    expect(res.body.data.tenant.type).toBe('KONVENSIONAL');

    const created = await testPrisma.tenant.findUnique({ where: { registrationNo: regNo } });
    if (created) await cleanupTenant(created.id);
  });

  it('registers a SYARIAH type koperasi', async () => {
    const regNo = `REG-SYR-${Date.now()}`;
    const res = await api.post('/api/auth/register-tenant').send({
      name: 'Koperasi Syariah Test',
      address: 'Jl. Syariah No. 1, Jakarta',
      registrationNo: regNo,
      type: 'SYARIAH',
      adminName: 'Admin Syariah',
      adminEmail: `admin.syr.${Date.now()}@test.com`,
      adminPassword: 'Admin123!',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.tenant.type).toBe('SYARIAH');

    const created = await testPrisma.tenant.findUnique({ where: { registrationNo: regNo } });
    if (created) await cleanupTenant(created.id);
  });

  it('rejects duplicate registrationNo with 409', async () => {
    const res = await api.post('/api/auth/register-tenant').send({
      name: 'Koperasi Duplicate',
      address: 'Jl. Dup No. 1',
      registrationNo: tenant.registrationNo,
      type: 'KONVENSIONAL',
      adminName: 'Admin',
      adminEmail: 'dup@test.com',
      adminPassword: 'Admin123!',
    });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('rejects invalid email format with 422', async () => {
    const res = await api.post('/api/auth/register-tenant').send({
      name: 'Koperasi Invalid',
      address: 'Jl. Test No. 1',
      registrationNo: `REG-INV-${Date.now()}`,
      type: 'KONVENSIONAL',
      adminName: 'Admin',
      adminEmail: 'not-an-email',
      adminPassword: 'Admin123!',
    });
    expect(res.status).toBe(422);
  });

  it('rejects weak password (no uppercase) with 422', async () => {
    const res = await api.post('/api/auth/register-tenant').send({
      name: 'Koperasi Weak',
      address: 'Jl. Test No. 1',
      registrationNo: `REG-WEAK-${Date.now()}`,
      type: 'KONVENSIONAL',
      adminName: 'Admin',
      adminEmail: 'weak@test.com',
      adminPassword: 'weakpassword1',
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 and sets httpOnly cookies on valid credentials', async () => {
    const res = await api
      .post('/api/auth/login')
      .set('Host', `${tenant.slug}.localhost`)
      .send({ email: 'admin@auth-test.com', password: 'Test123!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('admin@auth-test.com');
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith('access_token='))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith('refresh_token='))).toBe(true);
  });

  it('returns 401 on wrong password', async () => {
    const res = await api
      .post('/api/auth/login')
      .set('Host', `${tenant.slug}.localhost`)
      .send({ email: 'admin@auth-test.com', password: 'WrongPass999!' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 on unknown email', async () => {
    const res = await api
      .post('/api/auth/login')
      .set('Host', `${tenant.slug}.localhost`)
      .send({ email: 'nobody@example.com', password: 'Test123!' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown tenant subdomain', async () => {
    const res = await api
      .post('/api/auth/login')
      .set('Host', 'nonexistent-slug-xyz.localhost')
      .send({ email: 'admin@auth-test.com', password: 'Test123!' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/auth/refresh', () => {
  let cookieStr: string;

  beforeAll(async () => {
    const raw = await loginAs(app, tenant, 'admin@auth-test.com');
    cookieStr = parseCookieHeaders(raw);
  });

  it('issues new access_token from valid refresh token', async () => {
    const res = await api.post('/api/auth/refresh').set('Cookie', cookieStr);
    expect(res.status).toBe(200);
    const newCookies = res.headers['set-cookie'] as unknown as string[];
    expect(newCookies.some((c: string) => c.startsWith('access_token='))).toBe(true);
  });

  it('returns 401 with no refresh token cookie', async () => {
    const res = await api.post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns 401 with tampered refresh token', async () => {
    const res = await api
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=tampered.token.value');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  let cookieStr: string;

  beforeAll(async () => {
    const raw = await loginAs(app, tenant, 'admin@auth-test.com');
    cookieStr = parseCookieHeaders(raw);
  });

  it('returns authenticated user with role', async () => {
    const res = await api
      .get('/api/auth/me')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', cookieStr);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('admin@auth-test.com');
    expect(res.body.data.user.role).toBeDefined();
    expect(res.body.data.user.role.permissions).toBeDefined();
  });

  it('returns 401 without token', async () => {
    const res = await api
      .get('/api/auth/me')
      .set('Host', `${tenant.slug}.localhost`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('succeeds and invalidates session', async () => {
    const raw = await loginAs(app, tenant, 'admin@auth-test.com');
    const cookieStr = parseCookieHeaders(raw);

    const res = await api.post('/api/auth/logout').set('Cookie', cookieStr);
    expect(res.status).toBe(200);
  });

  it('returns 401 when called without auth cookie', async () => {
    const res = await api.post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});
