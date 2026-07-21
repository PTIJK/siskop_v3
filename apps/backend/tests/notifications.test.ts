import request from 'supertest';
import app from '../src/app';
import { subDays } from 'date-fns';
import { processBillingReminders } from '../src/lib/billing';
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
let secondAdminCookies: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  const { superAdminRole } = await createTestRoles(tenant.id);

  await createTestUser(tenant.id, superAdminRole.id, 'platform@notif-test.com', {
    isPlatformAdmin: true,
  });
  await createTestUser(tenant.id, superAdminRole.id, 'platform2@notif-test.com', {
    isPlatformAdmin: true,
  });

  platformAdminCookies = parseCookieHeaders(await loginAs(app, tenant, 'platform@notif-test.com'));
  secondAdminCookies = parseCookieHeaders(await loginAs(app, tenant, 'platform2@notif-test.com'));
});

afterAll(async () => {
  await cleanupTenant(tenant.id);
  await testPrisma.$disconnect();
});

describe('Notifications', () => {
  describe('Triggers', () => {
    it('creates a TENANT_REGISTERED notification on tenant registration', async () => {
      const res = await api.post('/api/auth/register-tenant').send({
        name: 'Koperasi Notif Test',
        address: 'Jl. Notifikasi No. 1',
        registrationNo: `REG-NOTIF-${Date.now()}`,
        type: 'KONVENSIONAL',
        cooperativeType: 'Koperasi Simpan Pinjam',
        adminName: 'Admin Notif',
        adminEmail: `admin.${Date.now()}@notif-register-test.com`,
        adminPassword: 'Admin123!',
      });
      expect(res.status).toBe(201);
      const newTenantId = res.body.data.tenant.id;

      const notif = await testPrisma.notification.findFirst({
        where: { type: 'TENANT_REGISTERED', relatedTenantId: newTenantId },
      });
      expect(notif).not.toBeNull();
      expect(notif?.title).toBe('Koperasi baru terdaftar');

      await cleanupTenant(newTenantId);
    });

    it('creates a BILLING_BLOCKED notification when a tenant is auto-blocked', async () => {
      const t = await createTestTenant();
      const { superAdminRole } = await createTestRoles(t.id);
      await createTestUser(t.id, superAdminRole.id, `overdue@notif-billing-test.com`);
      await testPrisma.tenant.update({
        where: { id: t.id },
        data: { nextBillingDate: subDays(new Date(), 1) },
      });

      await processBillingReminders(t.id);

      const notif = await testPrisma.notification.findFirst({
        where: { type: 'BILLING_BLOCKED', relatedTenantId: t.id },
      });
      expect(notif).not.toBeNull();

      await cleanupTenant(t.id);
    });

    it('creates a PACKAGE_CHANGED notification when a tenant package is updated', async () => {
      const pkg = await testPrisma.subscriptionPackage.create({
        data: { name: `Pkg Notif ${Date.now()}`, price: 0, modules: [], maxUsers: 5, maxMembers: 100 },
      });

      const res = await api
        .put(`/api/admin/tenants/${tenant.id}`)
        .set('Cookie', platformAdminCookies)
        .send({ packageId: pkg.id });

      expect(res.status).toBe(200);

      const notif = await testPrisma.notification.findFirst({
        where: { type: 'PACKAGE_CHANGED', relatedTenantId: tenant.id },
      });
      expect(notif).not.toBeNull();

      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: null } });
      await testPrisma.subscriptionPackage.delete({ where: { id: pkg.id } });
    });
  });

  describe('GET /api/admin/notifications', () => {
    it('lists notifications with isRead computed per requesting user', async () => {
      const res = await api
        .get('/api/admin/notifications')
        .set('Cookie', platformAdminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
      if (res.body.data.length > 0) {
        expect(typeof res.body.data[0].isRead).toBe('boolean');
      }
    });
  });

  describe('Read state (per platform admin user)', () => {
    it('marking one notification read for one user does not affect another user', async () => {
      const notif = await testPrisma.notification.create({
        data: {
          type: 'TENANT_REGISTERED',
          title: 'Test Notif',
          message: 'Test message',
          relatedTenantId: tenant.id,
        },
      });

      const before = await api
        .get('/api/admin/notifications/unread-count')
        .set('Cookie', platformAdminCookies);
      const beforeCount = before.body.data.count;

      const readRes = await api
        .post(`/api/admin/notifications/${notif.id}/read`)
        .set('Cookie', platformAdminCookies);
      expect(readRes.status).toBe(200);

      const afterFirstUser = await api
        .get('/api/admin/notifications/unread-count')
        .set('Cookie', platformAdminCookies);
      expect(afterFirstUser.body.data.count).toBe(beforeCount - 1);

      const secondUserCount = await api
        .get('/api/admin/notifications/unread-count')
        .set('Cookie', secondAdminCookies);
      expect(secondUserCount.body.data.count).toBeGreaterThanOrEqual(1);

      await testPrisma.notificationRead.deleteMany({ where: { notificationId: notif.id } });
      await testPrisma.notification.delete({ where: { id: notif.id } });
    });

    it('POST /api/admin/notifications/read-all marks everything read for that user', async () => {
      await testPrisma.notification.create({
        data: { type: 'TENANT_REGISTERED', title: 'A', message: 'A', relatedTenantId: tenant.id },
      });
      await testPrisma.notification.create({
        data: { type: 'TENANT_REGISTERED', title: 'B', message: 'B', relatedTenantId: tenant.id },
      });

      const res = await api
        .post('/api/admin/notifications/read-all')
        .set('Cookie', secondAdminCookies);
      expect(res.status).toBe(200);

      const count = await api
        .get('/api/admin/notifications/unread-count')
        .set('Cookie', secondAdminCookies);
      expect(count.body.data.count).toBe(0);
    });
  });
});
