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

const noReportsPerms = {
  ...fullPerms,
  reports: { read: false, export: false, update: false },
};

async function findAccount(tenantId: string, code: string) {
  return testPrisma.account.findFirstOrThrow({ where: { tenantId, code } });
}

async function ledgerBalance(tenantId: string, accountId: string, normalBalance: 'DEBIT' | 'KREDIT') {
  const agg = await testPrisma.journalLine.aggregate({
    where: { tenantId, accountId },
    _sum: { debit: true, credit: true },
  });
  const debit = Number(agg._sum.debit ?? 0);
  const credit = Number(agg._sum.credit ?? 0);
  return normalBalance === 'DEBIT' ? debit - credit : credit - debit;
}

describe('Regulatory Reports — Neraca & Laporan Arus Kas (Phase 3)', () => {
  let tenant: any;
  let adminCookies: string;
  let noReportsCookies: string;
  let memberId: string;
  let savingConfigId: string;
  let loanConfigId: string;

  beforeAll(async () => {
    tenant = await createTestTenant();

    const adminRole = await testPrisma.role.create({
      data: { tenantId: tenant.id, name: 'Admin', permissions: fullPerms },
    });
    const noReportsRole = await testPrisma.role.create({
      data: { tenantId: tenant.id, name: 'No Reports Access', permissions: noReportsPerms },
    });
    await createTestUser(tenant.id, adminRole.id, 'admin@regreports-test.com');
    await createTestUser(tenant.id, noReportsRole.id, 'noreports@regreports-test.com');
    adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@regreports-test.com'));
    noReportsCookies = parseCookieHeaders(await loginAs(app, tenant, 'noreports@regreports-test.com'));

    const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config', 'accounting']);
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

    await api
      .post('/api/config/accounts/seed-default')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies);

    const savingConfig = await testPrisma.savingConfig.create({
      data: {
        tenantId: tenant.id,
        name: 'Simpanan Sukarela Report Test',
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
        name: 'Kredit Report Test',
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
        name: 'Simpanan Pokok Report Test',
        type: 'POKOK',
        rateType: 'BUNGA',
        rate: 0,
        periodUnit: 'YEARLY',
      },
    });

    const member = await testPrisma.member.create({
      data: {
        tenantId: tenant.id,
        memberId: `KOP-RRPT-${new Date().toISOString().slice(0, 7).replace('-', '')}-0001`,
        accountNumber: `ACC-RRPT${Date.now()}`,
        fullName: 'Siti Aminah',
        nik: '3171040404800005',
        address: 'Jl. Sudirman No. 12, Jakarta',
        birthPlace: 'Jakarta',
        birthDate: new Date('1985-06-01'),
        occupation: 'Wiraswasta',
      },
    });
    memberId = member.id;

    await testPrisma.saving.create({
      data: { tenantId: tenant.id, memberId, savingConfigId: pokokConfig.id, balance: 500000 },
    });

    const kas = await findAccount(tenant.id, '1-1000');
    const simpananSukarela = await findAccount(tenant.id, '2-1000');
    const piutang = await findAccount(tenant.id, '1-1100');
    const pendapatanBunga = await findAccount(tenant.id, '4-1000');
    const pendapatanLain = await findAccount(tenant.id, '4-9000');

    const mappings: Array<[string, string, string, string]> = [
      ['SAVING_CONFIG', 'DEPOSIT', kas.id, simpananSukarela.id],
      ['SAVING_CONFIG', 'WITHDRAWAL', simpananSukarela.id, kas.id],
    ];
    for (const [sourceType, transactionKind, debitAccountId, creditAccountId] of mappings) {
      await api
        .put('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ sourceType, sourceId: savingConfigId, transactionKind, debitAccountId, creditAccountId });
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

    // Drive real transactions so the ledger has something to aggregate.
    const savingRes = await api
      .post('/api/savings')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ memberId, savingConfigId, initialDeposit: 0 });
    const savingId = savingRes.body.data.id;

    await api
      .post(`/api/savings/${savingId}/deposit`)
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ amount: 200000 });

    await api
      .post(`/api/savings/${savingId}/withdraw`)
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ amount: 50000 });

    const loanRes = await api
      .post('/api/loans')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ memberId, loanConfigId, principalAmount: 1000000, termMonths: 12 });
    const loanId = loanRes.body.data.id;

    const today = new Date().toISOString().split('T')[0];
    await api
      .post(`/api/loans/${loanId}/pay`)
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ amount: 100000, penalty: 5000, paidAt: today, dueDate: today });
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

  describe('Entitlement & permission gates', () => {
    it('returns 403 FEATURE_NOT_ENTITLED when the package lacks the accounting module', async () => {
      const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config']);
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

      const res = await api
        .get('/api/reports/regulatory/neraca')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_NOT_ENTITLED');

      const restored = await createPackage(['members', 'savings', 'loans', 'reports', 'config', 'accounting']);
      await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: restored.id } });
      await testPrisma.subscriptionPackage.delete({ where: { id: pkg.id } });
    });

    it('returns 403 FORBIDDEN when the role lacks the reports permission', async () => {
      const res = await api
        .get('/api/reports/regulatory/arus-kas')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', noReportsCookies);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /api/reports/regulatory/neraca', () => {
    it('aggregates ledger balances per account and self-checks ASET = KEWAJIBAN + EKUITAS', async () => {
      const kas = await findAccount(tenant.id, '1-1000');
      const simpananSukarela = await findAccount(tenant.id, '2-1000');
      const piutang = await findAccount(tenant.id, '1-1100');

      const expectedKas = await ledgerBalance(tenant.id, kas.id, 'DEBIT');
      const expectedSimpanan = await ledgerBalance(tenant.id, simpananSukarela.id, 'KREDIT');
      const expectedPiutang = await ledgerBalance(tenant.id, piutang.id, 'DEBIT');

      const res = await api
        .get('/api/reports/regulatory/neraca')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const { data } = res.body;

      const kasItem = data.aset.items.find((i: any) => i.code === '1-1000');
      const piutangItem = data.aset.items.find((i: any) => i.code === '1-1100');
      const simpananItem = data.kewajiban.items.find((i: any) => i.code === '2-1000');

      expect(Number(kasItem.balance)).toBe(expectedKas);
      expect(Number(piutangItem.balance)).toBe(expectedPiutang);
      expect(Number(simpananItem.balance)).toBe(expectedSimpanan);

      expect(Number(data.aset.total)).toBe(Number(data.totalKewajibanDanEkuitas));
      expect(data.balanced).toBe(true);

      const computedShu = data.ekuitas.items.find((i: any) => i.isComputed);
      expect(computedShu).toBeDefined();
    });
  });

  describe('GET /api/reports/regulatory/arus-kas', () => {
    it('rejects an invalid period where from > to', async () => {
      const res = await api
        .get('/api/reports/regulatory/arus-kas?from=2026-02-01&to=2026-01-01')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('REPORT_PERIOD_INVALID');
    });

    it('reconciles opening + net change against the actual ledger closing balance for Kas/Bank', async () => {
      const res = await api
        .get('/api/reports/regulatory/arus-kas')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const { data } = res.body;

      expect(Number(data.saldoKasAwal)).toBe(0);
      expect(data.aktivitasInvestasi.total).toBe('0');
      expect(data.aktivitasPendanaan.total).toBe('0');
      expect(Number(data.aktivitasOperasi.total)).toBe(Number(data.kenaikanPenurunanKasBersih));
      expect(Number(data.saldoKasAkhir)).toBe(Number(data.saldoKasAkhirAktual));
      expect(data.balanced).toBe(true);

      const labels = data.aktivitasOperasi.rincian.map((r: any) => r.label);
      expect(labels).toEqual(
        expect.arrayContaining([
          'Setoran/Penarikan Simpanan Anggota',
          'Penerimaan Angsuran Pinjaman',
          'Pencairan Pinjaman ke Anggota',
        ])
      );
    });
  });

  describe('POST /api/config/accounts/:id/mark-cash-equivalent', () => {
    it('toggles isCashEquivalent on a custom account', async () => {
      const createRes = await api
        .post('/api/config/accounts')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ code: '1-1050', name: 'Kas Kecil Cabang', category: 'ASET' });
      expect(createRes.status).toBe(201);
      const accountId = createRes.body.data.id;
      expect(createRes.body.data.isCashEquivalent).toBe(false);

      const markRes = await api
        .post(`/api/config/accounts/${accountId}/mark-cash-equivalent`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ isCashEquivalent: true });

      expect(markRes.status).toBe(200);
      expect(markRes.body.data.isCashEquivalent).toBe(true);

      const unmarkRes = await api
        .post(`/api/config/accounts/${accountId}/mark-cash-equivalent`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ isCashEquivalent: false });

      expect(unmarkRes.status).toBe(200);
      expect(unmarkRes.body.data.isCashEquivalent).toBe(false);
    });
  });

  describe('Arus Kas with no cash-equivalent accounts marked', () => {
    it('returns an explanatory note instead of aggregating over an empty account set', async () => {
      const kas = await findAccount(tenant.id, '1-1000');
      const bank = await findAccount(tenant.id, '1-1010');

      await api
        .post(`/api/config/accounts/${kas.id}/mark-cash-equivalent`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ isCashEquivalent: false });
      await api
        .post(`/api/config/accounts/${bank.id}/mark-cash-equivalent`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ isCashEquivalent: false });

      const res = await api
        .get('/api/reports/regulatory/arus-kas')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.catatan).toBeDefined();
      expect(res.body.data.saldoKasAwal).toBe('0');

      // Restore for hygiene, in case more tests get appended to this file later.
      await api
        .post(`/api/config/accounts/${kas.id}/mark-cash-equivalent`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ isCashEquivalent: true });
      await api
        .post(`/api/config/accounts/${bank.id}/mark-cash-equivalent`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ isCashEquivalent: true });
    });
  });
});
