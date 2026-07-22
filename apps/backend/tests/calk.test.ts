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

const fullPerms = {
  dashboard: { read: true },
  members: { create: true, read: true, update: true, delete: true },
  savings: { create: true, read: true, update: true, delete: true },
  loans: { create: true, read: true, update: true, delete: true },
  reports: { read: true, export: true, update: true },
  config: { read: true, update: true },
  users: { create: true, read: true, update: true, delete: true },
  roles: { create: true, read: true, update: true, delete: true },
  accounting: { create: true, read: true, update: true, delete: true },
};

const readOnlyReportsPerms = {
  ...fullPerms,
  reports: { read: true, export: true, update: false },
};

async function findAccount(tenantId: string, code: string) {
  return testPrisma.account.findFirstOrThrow({ where: { tenantId, code } });
}

describe('CALK (Catatan Atas Laporan Keuangan)', () => {
  let tenant: any;
  let adminCookies: string;
  let readOnlyCookies: string;

  beforeAll(async () => {
    tenant = await createTestTenant();

    const adminRole = await testPrisma.role.create({
      data: { tenantId: tenant.id, name: 'Admin', permissions: fullPerms },
    });
    await createTestUser(tenant.id, adminRole.id, 'admin@calk-test.com');
    adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@calk-test.com'));

    const readOnlyRole = await testPrisma.role.create({
      data: { tenantId: tenant.id, name: 'ReadOnly', permissions: readOnlyReportsPerms },
    });
    await createTestUser(tenant.id, readOnlyRole.id, 'readonly@calk-test.com');
    readOnlyCookies = parseCookieHeaders(await loginAs(app, tenant, 'readonly@calk-test.com'));

    const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config', 'accounting']);
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

    await api
      .post('/api/config/accounts/seed-default')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies);

    const savingConfig = await testPrisma.savingConfig.create({
      data: {
        tenantId: tenant.id,
        name: 'Simpanan Sukarela CALK Test',
        type: 'SUKARELA',
        rateType: 'BUNGA',
        rate: 2,
        periodUnit: 'MONTHLY',
      },
    });

    const kas = await findAccount(tenant.id, '1-1000');
    const simpananSukarela = await findAccount(tenant.id, '2-1000');
    await api
      .put('/api/config/account-mappings')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({
        sourceType: 'SAVING_CONFIG',
        sourceId: savingConfig.id,
        transactionKind: 'DEPOSIT',
        debitAccountId: kas.id,
        creditAccountId: simpananSukarela.id,
      });

    const member = await testPrisma.member.create({
      data: {
        tenantId: tenant.id,
        memberId: `KOP-CALK-${new Date().toISOString().slice(0, 7).replace('-', '')}-0001`,
        accountNumber: `ACC-CALK${Date.now()}`,
        fullName: 'Citra Lestari',
        nik: '3171040404800008',
        address: 'Jl. Anggrek No. 3, Jakarta',
        birthPlace: 'Jakarta',
        birthDate: new Date('1985-03-03'),
        occupation: 'Guru',
      },
    });

    const savingRes = await api
      .post('/api/savings')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ memberId: member.id, savingConfigId: savingConfig.id, initialDeposit: 0 });
    await api
      .post(`/api/savings/${savingRes.body.data.id}/deposit`)
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ amount: 250000 });
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

  describe('GET /api/reports/regulatory/calk', () => {
    it('returns the 4 fixed narrative sections empty by default and a self-consistent numeric section', async () => {
      const res = await api
        .get('/api/reports/regulatory/calk')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const { data } = res.body;

      expect(Object.keys(data.narasi).sort()).toEqual(
        ['DASAR_PENYUSUNAN', 'INFORMASI_TAMBAHAN', 'KEBIJAKAN_AKUNTANSI', 'UMUM'].sort()
      );
      for (const section of Object.values(data.narasi) as Array<{ content: string; updatedAt: string | null }>) {
        expect(section.content).toBe('');
        expect(section.updatedAt).toBeNull();
      }

      const kasRow = data.rincianAset.find((i: any) => i.code === '1-1000');
      expect(kasRow).toBeDefined();
      expect(Number(kasRow.saldoAwal)).toBe(0);
      expect(Number(kasRow.mutasi)).toBeCloseTo(250000, 2);
      expect(Number(kasRow.saldoAkhir)).toBeCloseTo(Number(kasRow.saldoAwal) + Number(kasRow.mutasi), 2);

      const simpananRow = data.rincianKewajiban.find((i: any) => i.code === '2-1000');
      expect(Number(simpananRow.saldoAkhir)).toBeCloseTo(250000, 2);
    });

    it('rejects an invalid period range with REPORT_PERIOD_INVALID', async () => {
      const res = await api
        .get('/api/reports/regulatory/calk')
        .query({ from: '2026-07-31', to: '2026-07-01' })
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('REPORT_PERIOD_INVALID');
    });
  });

  describe('PUT /api/reports/regulatory/calk/narrative', () => {
    it('rejects an unknown section', async () => {
      const res = await api
        .put('/api/reports/regulatory/calk/narrative')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ section: 'NOT_A_SECTION', content: 'x' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('upserts a narrative section and it is reused on the next GET regardless of period', async () => {
      const putRes = await api
        .put('/api/reports/regulatory/calk/narrative')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ section: 'DASAR_PENYUSUNAN', content: '<p>Disusun berdasarkan SAK EP.</p>' });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.content).toBe('<p>Disusun berdasarkan SAK EP.</p>');

      const getRes = await api
        .get('/api/reports/regulatory/calk')
        .query({ from: '2020-01-01', to: '2020-01-31' })
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(getRes.body.data.narasi.DASAR_PENYUSUNAN.content).toBe('<p>Disusun berdasarkan SAK EP.</p>');
      expect(getRes.body.data.narasi.DASAR_PENYUSUNAN.updatedAt).not.toBeNull();

      const updateRes = await api
        .put('/api/reports/regulatory/calk/narrative')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ section: 'DASAR_PENYUSUNAN', content: '<p>Revisi kebijakan.</p>' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.content).toBe('<p>Revisi kebijakan.</p>');

      const rows = await testPrisma.calkNarrative.findMany({ where: { tenantId: tenant.id } });
      expect(rows).toHaveLength(1);
    });

    it('returns 403 FORBIDDEN for a role without reports.update permission', async () => {
      const res = await api
        .put('/api/reports/regulatory/calk/narrative')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', readOnlyCookies)
        .send({ section: 'UMUM', content: 'x' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Entitlement gate', () => {
    it('returns 403 FEATURE_NOT_ENTITLED for calk when accounting is not entitled', async () => {
      const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config']);
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      const res = await api
        .get('/api/reports/regulatory/calk')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_NOT_ENTITLED');

      const restored = await createPackage(['members', 'savings', 'loans', 'reports', 'config', 'accounting']);
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: restored.id } });
      await testPrisma.subscriptionPackage.delete({ where: { id: pkg.id } });
    });
  });
});
