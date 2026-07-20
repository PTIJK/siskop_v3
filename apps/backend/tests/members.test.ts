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
let adminCookies: string;
let tellerCookies: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  const { superAdminRole, tellerRole } = await createTestRoles(tenant.id);

  await createTestUser(tenant.id, superAdminRole.id, 'admin@members-test.com');
  await createTestUser(tenant.id, tellerRole.id, 'teller@members-test.com');

  adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@members-test.com'));
  tellerCookies = parseCookieHeaders(await loginAs(app, tenant, 'teller@members-test.com'));
});

afterAll(async () => {
  await cleanupTenant(tenant.id);
  await testPrisma.$disconnect();
});

const basePayload = {
  fullName: 'Siti Rahayu',
  nik: '3171010101850001',
  address: 'Jl. Merdeka No. 10, Jakarta Pusat',
  birthPlace: 'Jakarta',
  birthDate: '1985-03-20',
  occupation: 'Pedagang',
};

describe('Members Module', () => {
  let memberId: string;

  // ── Create ──────────────────────────────────────────────────────────────────

  describe('POST /api/members', () => {
    it('returns 401 without authentication', async () => {
      const res = await api
        .post('/api/members')
        .set('Host', `${tenant.slug}.localhost`)
        .send(basePayload);
      expect(res.status).toBe(401);
    });

    it('returns 403 when teller lacks members.create permission', async () => {
      const res = await api
        .post('/api/members')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies)
        .send({ ...basePayload, nik: '3171010101850099' });
      expect(res.status).toBe(403);
    });

    it('creates member with auto-generated memberId and accountNumber', async () => {
      const res = await api
        .post('/api/members')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send(basePayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.memberId).toMatch(/^KOP-/);
      expect(res.body.data.accountNumber).toMatch(/^ACC-/);
      expect(res.body.data.isActive).toBe(true);
      memberId = res.body.data.id;
    });

    it('rejects duplicate NIK within same tenant with 409', async () => {
      const res = await api
        .post('/api/members')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send(basePayload);
      expect(res.status).toBe(409);
    });

    it('rejects missing required fields with 422', async () => {
      const res = await api
        .post('/api/members')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ fullName: 'Incomplete Member' });
      expect(res.status).toBe(422);
    });
  });

  // ── List ────────────────────────────────────────────────────────────────────

  describe('GET /api/members', () => {
    it('returns paginated list with meta', async () => {
      const res = await api
        .get('/api/members?page=1&limit=5')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(5);
      expect(typeof res.body.meta.total).toBe('number');
    });

    it('filters by search keyword', async () => {
      const res = await api
        .get('/api/members?search=Siti')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.some((m: any) => m.fullName.includes('Siti'))).toBe(true);
    });

    it('teller can read the members list', async () => {
      const res = await api
        .get('/api/members')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies);
      expect(res.status).toBe(200);
    });
  });

  // ── Get by ID ───────────────────────────────────────────────────────────────

  describe('GET /api/members/:id', () => {
    it('returns member detail including savings and loans arrays', async () => {
      const res = await api
        .get(`/api/members/${memberId}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(memberId);
      expect(Array.isArray(res.body.data.savings)).toBe(true);
      expect(Array.isArray(res.body.data.loans)).toBe(true);
    });

    it('returns 404 for a nonexistent member id', async () => {
      const res = await api
        .get('/api/members/nonexistent-cuid-0000')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);
      expect(res.status).toBe(404);
    });
  });

  // ── Update ──────────────────────────────────────────────────────────────────

  describe('PUT /api/members/:id', () => {
    it('updates member occupation field', async () => {
      const res = await api
        .put(`/api/members/${memberId}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ occupation: 'Wiraswasta' });

      expect(res.status).toBe(200);
      expect(res.body.data.occupation).toBe('Wiraswasta');
    });

    it('returns 403 when teller tries to update', async () => {
      const res = await api
        .put(`/api/members/${memberId}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies)
        .send({ occupation: 'Buruh' });
      expect(res.status).toBe(403);
    });
  });

  // ── Soft Delete ─────────────────────────────────────────────────────────────

  describe('DELETE /api/members/:id', () => {
    it('returns 403 when teller tries to delete', async () => {
      const res = await api
        .delete(`/api/members/${memberId}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies);
      expect(res.status).toBe(403);
    });

    it('soft-deletes member (sets isActive to false, does not hard-delete)', async () => {
      const res = await api
        .delete(`/api/members/${memberId}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);

      const member = await testPrisma.member.findUnique({ where: { id: memberId } });
      expect(member).not.toBeNull();
      expect(member?.isActive).toBe(false);
    });
  });
});
