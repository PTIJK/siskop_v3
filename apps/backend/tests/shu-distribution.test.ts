import request from 'supertest';
import app from '../src/app';
import { splitPrincipalAndInterest } from '../src/lib/journal';
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
  reports: { read: true, export: true },
  config: { read: true, update: true },
  users: { create: true, read: true, update: true, delete: true },
  roles: { create: true, read: true, update: true, delete: true },
  accounting: { create: true, read: true, update: true, delete: true },
};

async function findAccount(tenantId: string, code: string) {
  return testPrisma.account.findFirstOrThrow({ where: { tenantId, code } });
}

describe('Laporan Perhitungan Hasil Usaha & Daftar Pembagian SHU (Phase 3 step 2)', () => {
  let tenant: any;
  let adminCookies: string;
  let savingConfigId: string;
  let loanConfigId: string;
  let memberAId: string;
  let memberBId: string;
  let expectedInterestB = 0;
  let expectedPenaltyB = 0;

  beforeAll(async () => {
    tenant = await createTestTenant();

    const adminRole = await testPrisma.role.create({
      data: { tenantId: tenant.id, name: 'Admin', permissions: fullPerms },
    });
    await createTestUser(tenant.id, adminRole.id, 'admin@shu-test.com');
    adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@shu-test.com'));

    const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config', 'accounting']);
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

    await api
      .post('/api/config/accounts/seed-default')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies);

    const savingConfig = await testPrisma.savingConfig.create({
      data: {
        tenantId: tenant.id,
        name: 'Simpanan Sukarela SHU Test',
        type: 'SUKARELA',
        rateType: 'BUNGA',
        rate: 2,
        periodUnit: 'MONTHLY',
      },
    });
    savingConfigId = savingConfig.id;

    const loanConfig = await testPrisma.loanConfig.create({
      data: {
        tenantId: tenant.id,
        name: 'Kredit SHU Test',
        type: 'KONVENSIONAL',
        rateType: 'BUNGA',
        rate: 12,
        maxTermMonths: 24,
      },
    });
    loanConfigId = loanConfig.id;

    const pokokConfig = await testPrisma.savingConfig.create({
      data: {
        tenantId: tenant.id,
        name: 'Simpanan Pokok SHU Test',
        type: 'POKOK',
        rateType: 'BUNGA',
        rate: 0,
        periodUnit: 'YEARLY',
      },
    });

    const memberA = await testPrisma.member.create({
      data: {
        tenantId: tenant.id,
        memberId: `KOP-SHUA-${new Date().toISOString().slice(0, 7).replace('-', '')}-0001`,
        accountNumber: `ACC-SHUA${Date.now()}`,
        fullName: 'Ani Wijaya',
        nik: '3171040404800006',
        address: 'Jl. Melati No. 1, Jakarta',
        birthPlace: 'Jakarta',
        birthDate: new Date('1982-02-02'),
        occupation: 'Pedagang',
      },
    });
    memberAId = memberA.id;

    const memberB = await testPrisma.member.create({
      data: {
        tenantId: tenant.id,
        memberId: `KOP-SHUB-${new Date().toISOString().slice(0, 7).replace('-', '')}-0002`,
        accountNumber: `ACC-SHUB${Date.now()}`,
        fullName: 'Budi Kurniawan',
        nik: '3171040404800007',
        address: 'Jl. Kenanga No. 2, Jakarta',
        birthPlace: 'Bandung',
        birthDate: new Date('1979-05-05'),
        occupation: 'Wiraswasta',
      },
    });
    memberBId = memberB.id;

    await testPrisma.saving.create({
      data: { tenantId: tenant.id, memberId: memberAId, savingConfigId: pokokConfig.id, balance: 500000 },
    });
    await testPrisma.saving.create({
      data: { tenantId: tenant.id, memberId: memberBId, savingConfigId: pokokConfig.id, balance: 500000 },
    });

    const kas = await findAccount(tenant.id, '1-1000');
    const simpananSukarela = await findAccount(tenant.id, '2-1000');
    const piutang = await findAccount(tenant.id, '1-1100');
    const pendapatanBunga = await findAccount(tenant.id, '4-1000');
    const pendapatanLain = await findAccount(tenant.id, '4-9000');

    const savingMappings: Array<[string, string, string]> = [
      ['DEPOSIT', kas.id, simpananSukarela.id],
      ['WITHDRAWAL', simpananSukarela.id, kas.id],
    ];
    for (const [transactionKind, debitAccountId, creditAccountId] of savingMappings) {
      await api
        .put('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ sourceType: 'SAVING_CONFIG', sourceId: savingConfigId, transactionKind, debitAccountId, creditAccountId });
    }

    const loanMappings: Array<[string, string, string]> = [
      ['DISBURSEMENT', piutang.id, kas.id],
      ['PAYMENT_PRINCIPAL', kas.id, piutang.id],
      ['PAYMENT_INTEREST', kas.id, pendapatanBunga.id],
      ['PAYMENT_PENALTY', kas.id, pendapatanLain.id],
    ];
    for (const [transactionKind, debitAccountId, creditAccountId] of loanMappings) {
      await api
        .put('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ sourceType: 'LOAN_CONFIG', sourceId: loanConfigId, transactionKind, debitAccountId, creditAccountId });
    }

    // Member A: savings only, no loan.
    const savingResA = await api
      .post('/api/savings')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ memberId: memberAId, savingConfigId, initialDeposit: 0 });
    await api
      .post(`/api/savings/${savingResA.body.data.id}/deposit`)
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ amount: 300000 });

    // Member B: savings + a loan with a payment (principal + interest + penalty).
    const savingResB = await api
      .post('/api/savings')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ memberId: memberBId, savingConfigId, initialDeposit: 0 });
    await api
      .post(`/api/savings/${savingResB.body.data.id}/deposit`)
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ amount: 100000 });

    const loanRes = await api
      .post('/api/loans')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ memberId: memberBId, loanConfigId, principalAmount: 1000000, termMonths: 12 });
    const loanId = loanRes.body.data.id;

    const paymentAmount = 100000;
    const penalty = 5000;
    const today = new Date().toISOString().split('T')[0];
    await api
      .post(`/api/loans/${loanId}/pay`)
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ amount: paymentAmount, penalty, paidAt: today, dueDate: today });

    const loan = await testPrisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    const split = splitPrincipalAndInterest(paymentAmount, Number(loan.principalAmount), Number(loan.totalAmount));
    expectedInterestB = split.interest;
    expectedPenaltyB = penalty;
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

  describe('GET /api/reports/regulatory/laporan-hasil-usaha', () => {
    it('computes PENDAPATAN - BEBAN for the period as shuBerjalan', async () => {
      const res = await api
        .get('/api/reports/regulatory/laporan-hasil-usaha')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const { data } = res.body;

      const expectedTotalPendapatan = Math.round((expectedInterestB + expectedPenaltyB) * 100) / 100;
      expect(Number(data.pendapatan.total)).toBeCloseTo(expectedTotalPendapatan, 2);
      expect(Number(data.beban.total)).toBe(0);
      expect(Number(data.shuBerjalan)).toBeCloseTo(expectedTotalPendapatan, 2);

      const bungaItem = data.pendapatan.items.find((i: any) => i.code === '4-1000');
      expect(bungaItem.bukanAnggota).toBe('0');
      expect(Number(bungaItem.anggota)).toBeCloseTo(expectedInterestB, 2);
    });
  });

  describe('GET /api/reports/regulatory/shu-distribution — before config is set', () => {
    it('returns a catatan instead of an allocation', async () => {
      const res = await api
        .get('/api/reports/regulatory/shu-distribution')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.alokasi).toBeNull();
      expect(res.body.data.catatan).toBeDefined();
    });
  });

  describe('PUT /api/config/shu-distribution', () => {
    it('rejects a percentage split that does not sum to 100', async () => {
      const res = await api
        .put('/api/config/shu-distribution')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ jasaSimpananPercent: 40, jasaPinjamanPercent: 40, cadanganPercent: 10, lainnyaPercent: 5 });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SHU_DISTRIBUTION_PERCENT_INVALID');
    });

    it('accepts a valid 100% split', async () => {
      const res = await api
        .put('/api/config/shu-distribution')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ jasaSimpananPercent: 40, jasaPinjamanPercent: 40, cadanganPercent: 10, lainnyaPercent: 10 });

      expect(res.status).toBe(200);
      expect(Number(res.body.data.jasaSimpananPercent)).toBe(40);
    });
  });

  describe('GET /api/reports/regulatory/shu-distribution — after config is set', () => {
    it('allocates SHU across categories and per active member', async () => {
      const res = await api
        .get('/api/reports/regulatory/shu-distribution')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const { data } = res.body;

      const shuBerjalan = Number(data.shuBerjalan);
      expect(Number(data.alokasi.jasaSimpanan.total)).toBeCloseTo(shuBerjalan * 0.4, 2);
      expect(Number(data.alokasi.jasaPinjaman.total)).toBeCloseTo(shuBerjalan * 0.4, 2);
      expect(Number(data.alokasi.cadangan.total)).toBeCloseTo(shuBerjalan * 0.1, 2);
      expect(Number(data.alokasi.lainnya.total)).toBeCloseTo(shuBerjalan * 0.1, 2);

      const rowA = data.anggota.find((a: any) => a.fullName === 'Ani Wijaya');
      const rowB = data.anggota.find((a: any) => a.fullName === 'Budi Kurniawan');
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();

      // Member A never took a loan — no jasa pinjaman share.
      expect(Number(rowA.jasaPinjaman)).toBe(0);
      expect(Number(rowA.jasaSimpanan)).toBeGreaterThan(0);

      // Member B is the only one with loan interest paid — takes the entire jasa pinjaman pool.
      expect(Number(rowB.jasaPinjaman)).toBeCloseTo(Number(data.alokasi.jasaPinjaman.total), 2);
      expect(Number(rowB.jasaSimpanan)).toBeGreaterThan(0);

      const totalCheck =
        data.anggota.reduce((sum: number, a: any) => sum + Number(a.totalShu), 0);
      expect(totalCheck).toBeCloseTo(Number(data.totalDibagikanKeAnggota), 2);
      expect(Number(data.totalDibagikanKeAnggota)).toBeCloseTo(
        Number(data.alokasi.jasaSimpanan.total) + Number(data.alokasi.jasaPinjaman.total),
        1
      );
    });
  });

  describe('Entitlement gate', () => {
    it('returns 403 FEATURE_NOT_ENTITLED for shu-distribution report when accounting is not entitled', async () => {
      const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config']);
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      const res = await api
        .get('/api/reports/regulatory/shu-distribution')
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
