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
let platformAdminCookies: string;
let regularAdminCookies: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  const { superAdminRole } = await createTestRoles(tenant.id);

  // Regular admin (no platform access)
  await createTestUser(tenant.id, superAdminRole.id, 'regular@admin-test.com');

  // Platform admin (isPlatformAdmin: true)
  await createTestUser(tenant.id, superAdminRole.id, 'platform@admin-test.com', {
    isPlatformAdmin: true,
  });

  platformAdminCookies = parseCookieHeaders(
    await loginAs(app, tenant, 'platform@admin-test.com')
  );
  regularAdminCookies = parseCookieHeaders(
    await loginAs(app, tenant, 'regular@admin-test.com')
  );
});

afterAll(async () => {
  await cleanupTenant(tenant.id);
  await testPrisma.$disconnect();
});

describe('Admin Module (platform admin routes)', () => {
  // ── Auth guard ──────────────────────────────────────────────────────────────

  describe('Authorization', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await api.get('/api/admin/tenants');
      expect(res.status).toBe(401);
    });

    it('returns 403 when authenticated but not platform admin', async () => {
      const res = await api
        .get('/api/admin/tenants')
        .set('Cookie', regularAdminCookies);
      expect(res.status).toBe(403);
    });
  });

  // ── Dashboard ────────────────────────────────────────────────────────────────

  describe('GET /api/admin/dashboard', () => {
    it('returns platform dashboard stats', async () => {
      const res = await api
        .get('/api/admin/dashboard')
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── Tenants ──────────────────────────────────────────────────────────────────

  describe('GET /api/admin/tenants', () => {
    it('returns paginated list of all tenants', async () => {
      const res = await api
        .get('/api/admin/tenants?page=1&limit=10')
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
      // Our test tenant should appear in the list
      expect(res.body.data.some((t: any) => t.id === tenant.id)).toBe(true);
    });
  });

  describe('GET /api/admin/tenants/:id', () => {
    it('returns full tenant detail', async () => {
      const res = await api
        .get(`/api/admin/tenants/${tenant.id}`)
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(tenant.id);
      expect(res.body.data.slug).toBe(tenant.slug);
    });

    it('returns 404 for nonexistent tenant', async () => {
      const res = await api
        .get('/api/admin/tenants/nonexistent-tenant-id')
        .set('Cookie', platformAdminCookies);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/tenants/:id', () => {
    it('updates tenant isActive flag', async () => {
      const res = await api
        .put(`/api/admin/tenants/${tenant.id}`)
        .set('Cookie', platformAdminCookies)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);

      // Re-activate so afterAll cleanup works cleanly
      await api
        .put(`/api/admin/tenants/${tenant.id}`)
        .set('Cookie', platformAdminCookies)
        .send({ isActive: true });
    });
  });

  describe('GET /api/admin/tenants/:id/stats', () => {
    it('returns tenant usage statistics', async () => {
      const res = await api
        .get(`/api/admin/tenants/${tenant.id}/stats`)
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── Packages ─────────────────────────────────────────────────────────────────

  describe('GET /api/admin/packages', () => {
    it('returns list of subscription packages', async () => {
      const res = await api
        .get('/api/admin/packages')
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /api/admin/packages', () => {
    it('creates a new subscription package', async () => {
      const res = await api
        .post('/api/admin/packages')
        .set('Cookie', platformAdminCookies)
        .send({
          name: 'Paket Starter Test',
          price: 99000,
          modules: ['members', 'savings', 'loans'],
          maxUsers: 5,
          maxMembers: 100,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Paket Starter Test');

      // Cleanup
      await testPrisma.subscriptionPackage.delete({ where: { id: res.body.data.id } });
    });
  });
});
