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

  describe('PUT /api/admin/tenants/:id — billing date', () => {
    it('updates nextBillingDate and resets reminder-sent flags', async () => {
      // Seed reminder flags as if a previous cycle already sent them.
      await testPrisma.tenant.update({
        where: { id: tenant.id },
        data: { billingReminder30SentAt: new Date(), billingReminder7SentAt: new Date() },
      });

      const future = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
      const res = await api
        .put(`/api/admin/tenants/${tenant.id}`)
        .set('Cookie', platformAdminCookies)
        .send({ nextBillingDate: future.toISOString() });

      expect(res.status).toBe(200);
      expect(new Date(res.body.data.nextBillingDate).toDateString()).toBe(
        future.toDateString()
      );
      expect(res.body.data.billingReminder30SentAt).toBeNull();
      expect(res.body.data.billingReminder7SentAt).toBeNull();
    });

    it('reactivates a billing-blocked tenant when billing date is renewed to the future', async () => {
      await testPrisma.tenant.update({
        where: { id: tenant.id },
        data: { isActive: false },
      });

      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const res = await api
        .put(`/api/admin/tenants/${tenant.id}`)
        .set('Cookie', platformAdminCookies)
        .send({ nextBillingDate: future.toISOString() });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
    });

    it('clears nextBillingDate when set to null', async () => {
      const res = await api
        .put(`/api/admin/tenants/${tenant.id}`)
        .set('Cookie', platformAdminCookies)
        .send({ nextBillingDate: null });

      expect(res.status).toBe(200);
      expect(res.body.data.nextBillingDate).toBeNull();
    });
  });

  describe('POST /api/admin/tenants/:id/logo', () => {
    it('uploads a logo and updates tenant.logoUrl', async () => {
      const res = await api
        .post(`/api/admin/tenants/${tenant.id}/logo`)
        .set('Cookie', platformAdminCookies)
        .attach('logo', Buffer.from('fake-image-content'), { filename: 'logo.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(res.body.data.logoUrl).toBeTruthy();

      const updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
      expect(updated?.logoUrl).toBeTruthy();
    });

    it('rejects non-image file types', async () => {
      const res = await api
        .post(`/api/admin/tenants/${tenant.id}/logo`)
        .set('Cookie', platformAdminCookies)
        .attach('logo', Buffer.from('not an image'), { filename: 'logo.txt', contentType: 'text/plain' });

      expect(res.status).toBe(400);
    });

    it('returns 403 for non-platform-admin', async () => {
      const res = await api
        .post(`/api/admin/tenants/${tenant.id}/logo`)
        .set('Cookie', regularAdminCookies)
        .attach('logo', Buffer.from('fake-image-content'), { filename: 'logo.png', contentType: 'image/png' });

      expect(res.status).toBe(403);
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

  // ── Platform admin users ─────────────────────────────────────────────────────

  describe('GET /api/admin/users', () => {
    it('returns list of platform admins only', async () => {
      const res = await api
        .get('/api/admin/users')
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.every((u: any) => u.isPlatformAdmin)).toBe(true);
      expect(res.body.data.some((u: any) => u.email === 'platform@admin-test.com')).toBe(true);
    });
  });

  describe('POST /api/admin/users', () => {
    let createdId: string;

    it('creates a new platform admin', async () => {
      const res = await api
        .post('/api/admin/users')
        .set('Cookie', platformAdminCookies)
        .send({
          name: 'Admin Baru',
          email: `newadmin.${Date.now()}@platform-test.com`,
          password: 'Admin123!',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isPlatformAdmin).toBe(true);
      createdId = res.body.data.id;
    });

    it('rejects duplicate email among platform admins', async () => {
      const res = await api
        .post('/api/admin/users')
        .set('Cookie', platformAdminCookies)
        .send({ name: 'Duplicate', email: 'platform@admin-test.com', password: 'Admin123!' });

      expect(res.status).toBe(409);
    });

    afterAll(async () => {
      if (createdId) await testPrisma.user.delete({ where: { id: createdId } });
    });
  });

  describe('DELETE /api/admin/users/:id', () => {
    it('deactivates a platform admin', async () => {
      const target = await testPrisma.user.create({
        data: {
          tenantId: tenant.id,
          roleId: (await testPrisma.role.findFirst({ where: { tenantId: tenant.id } }))!.id,
          email: `todeactivate.${Date.now()}@platform-test.com`,
          passwordHash: 'x',
          name: 'To Deactivate',
          isPlatformAdmin: true,
          isActive: true,
        },
      });

      const res = await api
        .delete(`/api/admin/users/${target.id}`)
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(200);
      const found = await testPrisma.user.findUnique({ where: { id: target.id } });
      expect(found?.isActive).toBe(false);
    });

    it('returns 400 when trying to deactivate your own account', async () => {
      const me = await testPrisma.user.findFirst({ where: { email: 'platform@admin-test.com' } });
      const res = await api
        .delete(`/api/admin/users/${me!.id}`)
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
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
