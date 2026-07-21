import request from 'supertest';
import app from '../src/app';
import {
  testPrisma,
  createTestTenant,
  createTestUser,
  loginAs,
  cleanupTenant,
  parseCookieHeaders,
} from './helpers/setup';

const api = request(app);

async function createPackage(modules: string[]) {
  return testPrisma.subscriptionPackage.create({
    data: {
      name: `Test Package ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      price: 0,
      modules,
      maxUsers: 10,
      maxMembers: 1000,
    },
  });
}

const accountingPerms = {
  dashboard: { read: true },
  members: { create: true, read: true, update: true, delete: true },
  savings: { create: true, read: true, update: true, delete: true },
  loans: { create: true, read: true, update: true, delete: true },
  reports: { read: true, export: true },
  config: { read: true, update: true },
  users: { create: true, read: true, update: true, delete: true },
  roles: { create: true, read: true, update: true, delete: true },
  accounting: { create: true, read: true, update: true, delete: true },
};

const noAccountingPerms = {
  ...accountingPerms,
  accounting: { create: false, read: false, update: false, delete: false },
};

describe('Konfigurasi Akun (COA) Module', () => {
  let tenant: any;
  let adminCookies: string;
  let noAccessCookies: string;

  beforeAll(async () => {
    tenant = await createTestTenant();

    const accountingRole = await testPrisma.role.create({
      data: { tenantId: tenant.id, name: 'Accounting Admin', permissions: accountingPerms },
    });
    const noAccessRole = await testPrisma.role.create({
      data: { tenantId: tenant.id, name: 'No Accounting Access', permissions: noAccountingPerms },
    });

    await createTestUser(tenant.id, accountingRole.id, 'coa-admin@coa-test.com');
    await createTestUser(tenant.id, noAccessRole.id, 'coa-noaccess@coa-test.com');

    const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config', 'accounting']);
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

    adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'coa-admin@coa-test.com'));
    noAccessCookies = parseCookieHeaders(await loginAs(app, tenant, 'coa-noaccess@coa-test.com'));
  });

  afterAll(async () => {
    const current = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    if (current?.packageId) {
      const pkgId = current.packageId;
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: null } });
      await testPrisma.subscriptionPackage.delete({ where: { id: pkgId } });
    }
    await cleanupTenant(tenant.id);
    await testPrisma.$disconnect();
  });

  describe('Package entitlement gate', () => {
    it('returns 403 FEATURE_NOT_ENTITLED when the package does not include the accounting module', async () => {
      const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config']);
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      const res = await api
        .get('/api/config/accounts')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_NOT_ENTITLED');

      // Restore accounting-entitled package for subsequent tests
      const restored = await createPackage(['members', 'savings', 'loans', 'reports', 'config', 'accounting']);
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: restored.id } });
      await testPrisma.subscriptionPackage.delete({ where: { id: pkg.id } });
    });

    it('returns 403 FORBIDDEN when the role lacks accounting permission (even with entitlement)', async () => {
      const res = await api
        .get('/api/config/accounts')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', noAccessCookies);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/config/accounts/seed-default', () => {
    it('seeds the standard COA template on an empty account list', async () => {
      const res = await api
        .post('/api/config/accounts/seed-default')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(201);
      expect(res.body.data.length).toBe(20);
      expect(res.body.data.every((a: any) => a.isDefault)).toBe(true);
    });

    it('blocks re-seeding once the tenant already has accounts', async () => {
      const res = await api
        .post('/api/config/accounts/seed-default')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('COA_ALREADY_SEEDED');
    });
  });

  describe('GET /api/config/accounts', () => {
    it('lists accounts filtered by category', async () => {
      const res = await api
        .get('/api/config/accounts')
        .query({ category: 'ASET' })
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.every((a: any) => a.category === 'ASET')).toBe(true);
      expect(res.body.data.length).toBe(5);
    });
  });

  describe('POST /api/config/accounts', () => {
    it('creates a custom account with a code matching its category prefix', async () => {
      const res = await api
        .post('/api/config/accounts')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ code: '1-1500', name: 'Kas Kecil', category: 'ASET', isHeader: false });

      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe('1-1500');
      expect(res.body.data.normalBalance).toBe('DEBIT');
      expect(res.body.data.isDefault).toBe(false);
    });

    it('rejects a code that does not match the category prefix', async () => {
      const res = await api
        .post('/api/config/accounts')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ code: '2-9999', name: 'Salah Kategori', category: 'ASET', isHeader: false });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ACCOUNT_CODE_INVALID_FORMAT');
    });

    it('rejects a duplicate code within the same tenant', async () => {
      const res = await api
        .post('/api/config/accounts')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ code: '1-1500', name: 'Duplikat', category: 'ASET', isHeader: false });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ACCOUNT_CODE_DUPLICATE');
    });
  });

  describe('DELETE /api/config/accounts/:id', () => {
    it('blocks deactivating a default (seeded) account', async () => {
      const kas = await testPrisma.account.findFirstOrThrow({ where: { tenantId: tenant.id, code: '1-1000' } });

      const res = await api
        .delete(`/api/config/accounts/${kas.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ACCOUNT_IN_USE');
    });

    it('deactivates a non-default, unmapped account', async () => {
      const kasKecil = await testPrisma.account.findFirstOrThrow({ where: { tenantId: tenant.id, code: '1-1500' } });

      const res = await api
        .delete(`/api/config/accounts/${kasKecil.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const updated = await testPrisma.account.findUnique({ where: { id: kasKecil.id } });
      expect(updated?.isActive).toBe(false);
    });
  });

  describe('Account mappings', () => {
    let savingConfigId: string;
    let loanConfigId: string;

    beforeAll(async () => {
      const savingConfig = await testPrisma.savingConfig.create({
        data: {
          tenantId: tenant.id,
          name: 'Simpanan Sukarela COA Test',
          type: 'SUKARELA',
          rateType: 'BUNGA',
          rate: 2,
          periodUnit: 'MONTHLY',
          isActive: true,
        },
      });
      savingConfigId = savingConfig.id;

      const loanConfig = await testPrisma.loanConfig.create({
        data: {
          tenantId: tenant.id,
          name: 'Pinjaman COA Test',
          type: 'KONVENSIONAL',
          rateType: 'BUNGA',
          rate: 12,
          maxTermMonths: 12,
          isActive: true,
        },
      });
      loanConfigId = loanConfig.id;
    });

    afterAll(async () => {
      await testPrisma.accountMapping.deleteMany({ where: { tenantId: tenant.id } });
      await testPrisma.savingConfig.delete({ where: { id: savingConfigId } });
      await testPrisma.loanConfig.delete({ where: { id: loanConfigId } });
    });

    it('rejects a mapping whose debit/credit categories violate the expected shape', async () => {
      const kas = await testPrisma.account.findFirstOrThrow({ where: { tenantId: tenant.id, code: '1-1000' } });
      const simpananSukarela = await testPrisma.account.findFirstOrThrow({
        where: { tenantId: tenant.id, code: '2-1000' },
      });

      // DEPOSIT should debit ASET / credit EKUITAS|KEWAJIBAN — this reverses it.
      const res = await api
        .put('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          sourceType: 'SAVING_CONFIG',
          sourceId: savingConfigId,
          transactionKind: 'DEPOSIT',
          debitAccountId: simpananSukarela.id,
          creditAccountId: kas.id,
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('MAPPING_ACCOUNT_CATEGORY_MISMATCH');
    });

    it('rejects a transactionKind that does not apply to the given sourceType', async () => {
      const kas = await testPrisma.account.findFirstOrThrow({ where: { tenantId: tenant.id, code: '1-1000' } });
      const simpananSukarela = await testPrisma.account.findFirstOrThrow({
        where: { tenantId: tenant.id, code: '2-1000' },
      });

      const res = await api
        .put('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          sourceType: 'SAVING_CONFIG',
          sourceId: savingConfigId,
          transactionKind: 'DISBURSEMENT',
          debitAccountId: kas.id,
          creditAccountId: simpananSukarela.id,
        });

      expect(res.status).toBe(422);
    });

    it('accepts and upserts a correctly-shaped mapping', async () => {
      const kas = await testPrisma.account.findFirstOrThrow({ where: { tenantId: tenant.id, code: '1-1000' } });
      const simpananSukarela = await testPrisma.account.findFirstOrThrow({
        where: { tenantId: tenant.id, code: '2-1000' },
      });

      const res = await api
        .put('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          sourceType: 'SAVING_CONFIG',
          sourceId: savingConfigId,
          transactionKind: 'DEPOSIT',
          debitAccountId: kas.id,
          creditAccountId: simpananSukarela.id,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.debitAccountId).toBe(kas.id);
      expect(res.body.data.creditAccountId).toBe(simpananSukarela.id);

      // Upsert again with a different credit account — should update, not duplicate
      const bank = await testPrisma.account.findFirstOrThrow({ where: { tenantId: tenant.id, code: '1-1010' } });
      const res2 = await api
        .put('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          sourceType: 'SAVING_CONFIG',
          sourceId: savingConfigId,
          transactionKind: 'DEPOSIT',
          debitAccountId: bank.id,
          creditAccountId: simpananSukarela.id,
        });
      expect(res2.status).toBe(200);

      const count = await testPrisma.accountMapping.count({
        where: { tenantId: tenant.id, sourceType: 'SAVING_CONFIG', sourceId: savingConfigId, transactionKind: 'DEPOSIT' },
      });
      expect(count).toBe(1);
    });

    it('blocks deactivating an account that is referenced by a mapping', async () => {
      const bank = await testPrisma.account.findFirstOrThrow({ where: { tenantId: tenant.id, code: '1-1010' } });

      const res = await api
        .delete(`/api/config/accounts/${bank.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ACCOUNT_IN_USE');
    });

    it('reports mapping completeness across active saving/loan configs', async () => {
      const res = await api
        .get('/api/config/account-mappings/completeness')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      // 1 saving config × 2 kinds + 1 loan config × 4 kinds = 6 expected; 1 mapped (DEPOSIT)
      expect(res.body.data.total).toBe(6);
      expect(res.body.data.mapped).toBe(1);
      expect(res.body.data.unmapped).toBe(5);
    });

    it('lists mappings joined with the source config name', async () => {
      const res = await api
        .get('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const mapping = res.body.data.find((m: any) => m.sourceId === savingConfigId);
      expect(mapping.sourceName).toBe('Simpanan Sukarela COA Test');
    });
  });
});
