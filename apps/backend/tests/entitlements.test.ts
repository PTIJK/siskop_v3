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

async function createPackage(data: {
  maxSavingConfigs?: number | null;
  whitelabelEnabled?: boolean;
}) {
  return testPrisma.subscriptionPackage.create({
    data: {
      name: `Test Package ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      price: 0,
      modules: ['members', 'savings', 'loans', 'reports', 'config'],
      maxUsers: 10,
      maxMembers: 1000,
      maxSavingConfigs: data.maxSavingConfigs ?? null,
      whitelabelEnabled: data.whitelabelEnabled ?? false,
    },
  });
}

describe('Package Entitlements', () => {
  let tenant: any;
  let adminCookies: string;

  beforeAll(async () => {
    tenant = await createTestTenant();
    const { superAdminRole } = await createTestRoles(tenant.id);
    await createTestUser(tenant.id, superAdminRole.id, 'admin@entitlement-test.com');
    adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@entitlement-test.com'));
  });

  afterAll(async () => {
    await cleanupTenant(tenant.id);
    await testPrisma.$disconnect();
  });

  afterEach(async () => {
    // Detach + remove any package assigned during a test, and clear custom configs
    await testPrisma.savingConfig.deleteMany({ where: { tenantId: tenant.id, isDefault: false } });
    const current = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    if (current?.packageId) {
      const pkgId = current.packageId;
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: null } });
      await testPrisma.subscriptionPackage.delete({ where: { id: pkgId } });
    }
  });

  describe('Simpanan custom quota', () => {
    it('allows creating custom SavingConfig when package has no cap (unlimited)', async () => {
      const pkg = await createPackage({ maxSavingConfigs: null });
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      const res = await api
        .post('/api/savings/configs')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ name: 'Simpanan Haji', type: 'SUKARELA', rateType: 'BUNGA', rate: 2, periodUnit: 'MONTHLY' });

      expect(res.status).toBe(201);
    });

    it('blocks creating custom SavingConfig once the package cap is reached', async () => {
      const pkg = await createPackage({ maxSavingConfigs: 1 });
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      const first = await api
        .post('/api/savings/configs')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ name: 'Simpanan Custom 1', type: 'SUKARELA', rateType: 'BUNGA', rate: 2, periodUnit: 'MONTHLY' });
      expect(first.status).toBe(201);

      const second = await api
        .post('/api/savings/configs')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ name: 'Simpanan Custom 2', type: 'SUKARELA', rateType: 'BUNGA', rate: 2, periodUnit: 'MONTHLY' });

      expect(second.status).toBe(422);
      expect(second.body.error.code).toBe('PACKAGE_LIMIT_EXCEEDED');
    });

    it('default SavingConfig rows do not count toward the custom quota', async () => {
      const pkg = await createPackage({ maxSavingConfigs: 0 });
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      // Tenant already has 0 custom configs (defaults are excluded), so cap of 0 still blocks new custom creation...
      const res = await api
        .post('/api/savings/configs')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ name: 'Simpanan Custom X', type: 'SUKARELA', rateType: 'BUNGA', rate: 2, periodUnit: 'MONTHLY' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PACKAGE_LIMIT_EXCEEDED');
    });

    it('freezes the newest custom configs first after a package downgrade', async () => {
      const unlimitedPkg = await createPackage({ maxSavingConfigs: null });
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: unlimitedPkg.id } });

      const oldest = await testPrisma.savingConfig.create({
        data: {
          tenantId: tenant.id,
          name: 'Custom Oldest',
          type: 'SUKARELA',
          rateType: 'BUNGA',
          rate: 1,
          periodUnit: 'MONTHLY',
          isDefault: false,
        },
      });
      await new Promise((r) => setTimeout(r, 10));
      const newest = await testPrisma.savingConfig.create({
        data: {
          tenantId: tenant.id,
          name: 'Custom Newest',
          type: 'SUKARELA',
          rateType: 'BUNGA',
          rate: 1,
          periodUnit: 'MONTHLY',
          isDefault: false,
        },
      });

      // Downgrade to a package that only allows 1 custom config
      const downgradedPkg = await createPackage({ maxSavingConfigs: 1 });
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: downgradedPkg.id } });
      await testPrisma.subscriptionPackage.delete({ where: { id: unlimitedPkg.id } });

      // Oldest stays editable
      const editOldest = await api
        .put(`/api/savings/configs/${oldest.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ rate: 1.5 });
      expect(editOldest.status).toBe(200);

      // Newest is frozen
      const editNewest = await api
        .put(`/api/savings/configs/${newest.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ rate: 1.5 });
      expect(editNewest.status).toBe(422);
      expect(editNewest.body.error.code).toBe('PACKAGE_LIMIT_EXCEEDED');

      await testPrisma.savingConfig.deleteMany({ where: { id: { in: [oldest.id, newest.id] } } });
    });
  });

  describe('Whitelabel entitlement', () => {
    it('blocks whitelabel writes when the package does not enable it', async () => {
      const pkg = await createPackage({ whitelabelEnabled: false });
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      const res = await api
        .put('/api/config/whitelabel')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ primaryColor: '#123456' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_NOT_ENTITLED');
    });

    it('allows whitelabel writes when the package enables it', async () => {
      const pkg = await createPackage({ whitelabelEnabled: true });
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      const res = await api
        .put('/api/config/whitelabel')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ primaryColor: '#123456', hideBranding: true });

      expect(res.status).toBe(200);
      expect(res.body.data.primaryColor).toBe('#123456');

      await testPrisma.whitelabelConfig.deleteMany({ where: { tenantId: tenant.id } });
    });

    it('tenant with no package assigned is not entitled to whitelabel', async () => {
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: null } });

      const res = await api
        .put('/api/config/whitelabel')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ hideBranding: true });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_NOT_ENTITLED');
    });
  });
});
