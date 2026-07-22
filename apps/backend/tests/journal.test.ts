import request from 'supertest';
import app from '../src/app';
import { LoanType, RateType } from '@siskop/shared';
import { calculateLoan } from '../src/lib/loan-calc';
import {
  testPrisma,
  createTestTenant,
  createTestUser,
  loginAs,
  cleanupTenant,
  parseCookieHeaders,
} from './helpers/setup';

const api = request(app);

const fullPermsWithAccounting = {
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

async function findAccount(tenantId: string, code: string) {
  return testPrisma.account.findFirstOrThrow({ where: { tenantId, code } });
}

async function findJournalEntry(tenantId: string, sourceType: string, sourceId: string) {
  return testPrisma.journalEntry.findFirstOrThrow({
    where: { tenantId, sourceType: sourceType as never, sourceId },
    include: { lines: true },
  });
}

describe('Journal Posting Engine (Phase 2)', () => {
  let tenant: any;
  let adminCookies: string;
  let memberId: string;
  let savingConfigId: string;
  let loanConfigId: string;

  beforeAll(async () => {
    tenant = await createTestTenant();
    const accountingRole = await testPrisma.role.create({
      data: { tenantId: tenant.id, name: 'Accounting Admin', permissions: fullPermsWithAccounting },
    });
    await createTestUser(tenant.id, accountingRole.id, 'admin@journal-test.com');
    adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@journal-test.com'));

    const pkg = await createPackage(['members', 'savings', 'loans', 'reports', 'config', 'accounting']);
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });

    await api
      .post('/api/config/accounts/seed-default')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies);

    const savingConfig = await testPrisma.savingConfig.create({
      data: {
        tenantId: tenant.id,
        name: 'Simpanan Sukarela Journal Test',
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
        name: 'Kredit Journal Test',
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
        name: 'Simpanan Pokok Journal Test',
        type: 'POKOK',
        rateType: 'BUNGA',
        rate: 0,
        periodUnit: 'YEARLY',
      },
    });

    const member = await testPrisma.member.create({
      data: {
        tenantId: tenant.id,
        memberId: `KOP-JRNL-${new Date().toISOString().slice(0, 7).replace('-', '')}-0001`,
        accountNumber: `ACC-JRNL${Date.now()}`,
        fullName: 'Budi Santoso',
        nik: '3171040404800004',
        address: 'Jl. Merdeka No. 7, Jakarta',
        birthPlace: 'Jakarta',
        birthDate: new Date('1980-04-04'),
        occupation: 'Wiraswasta',
      },
    });
    memberId = member.id;

    await testPrisma.saving.create({
      data: { tenantId: tenant.id, memberId, savingConfigId: pokokConfig.id, balance: 500000 },
    });
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

  describe('Missing mapping', () => {
    it('creates an UNPOSTED_MISSING_MAPPING entry (no lines) when no AccountMapping exists yet', async () => {
      const res = await api
        .post('/api/savings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, savingConfigId, initialDeposit: 75000 });

      expect(res.status).toBe(201);

      const savingTxn = await testPrisma.savingTransaction.findFirstOrThrow({
        where: { savingId: res.body.data.id },
      });
      const entry = await findJournalEntry(tenant.id, 'SAVING_TRANSACTION', savingTxn.id);

      expect(entry.status).toBe('UNPOSTED_MISSING_MAPPING');
      expect(entry.lines.length).toBe(0);

      // Doesn't block the underlying savings flow — balance still updates normally.
      const saving = await testPrisma.saving.findUnique({ where: { id: res.body.data.id } });
      expect(Number(saving!.balance)).toBe(75000);
    });
  });

  describe('Savings deposit/withdrawal — mapped', () => {
    let savingId: string;

    beforeAll(async () => {
      const kas = await findAccount(tenant.id, '1-1000');
      const simpananSukarela = await findAccount(tenant.id, '2-1000');

      await api
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

      await api
        .put('/api/config/account-mappings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          sourceType: 'SAVING_CONFIG',
          sourceId: savingConfigId,
          transactionKind: 'WITHDRAWAL',
          debitAccountId: simpananSukarela.id,
          creditAccountId: kas.id,
        });

      const res = await api
        .post('/api/savings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, savingConfigId, initialDeposit: 0 });
      savingId = res.body.data.id;
    });

    it('posts a balanced POSTED entry on deposit, debiting Kas and crediting Simpanan Sukarela', async () => {
      const kas = await findAccount(tenant.id, '1-1000');
      const simpananSukarela = await findAccount(tenant.id, '2-1000');

      const res = await api
        .post(`/api/savings/${savingId}/deposit`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 200000 });

      expect(res.status).toBe(201);

      const entry = await findJournalEntry(tenant.id, 'SAVING_TRANSACTION', res.body.data.id);
      expect(entry.status).toBe('POSTED');
      expect(entry.lines.length).toBe(2);

      const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(totalDebit).toBe(200000);
      expect(totalCredit).toBe(200000);

      const debitLine = entry.lines.find((l) => Number(l.debit) > 0);
      const creditLine = entry.lines.find((l) => Number(l.credit) > 0);
      expect(debitLine?.accountId).toBe(kas.id);
      expect(creditLine?.accountId).toBe(simpananSukarela.id);
    });

    it('posts a balanced POSTED entry on withdrawal, reversing debit/credit', async () => {
      const kas = await findAccount(tenant.id, '1-1000');
      const simpananSukarela = await findAccount(tenant.id, '2-1000');

      const res = await api
        .post(`/api/savings/${savingId}/withdraw`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 50000 });

      expect(res.status).toBe(201);

      const entry = await findJournalEntry(tenant.id, 'SAVING_TRANSACTION', res.body.data.id);
      expect(entry.status).toBe('POSTED');

      const debitLine = entry.lines.find((l) => Number(l.debit) > 0);
      const creditLine = entry.lines.find((l) => Number(l.credit) > 0);
      expect(debitLine?.accountId).toBe(simpananSukarela.id);
      expect(creditLine?.accountId).toBe(kas.id);
    });
  });

  describe('Loan disbursement and payment — mapped', () => {
    let loanId: string;
    const principal = 1_200_000;
    const termMonths = 12;
    const rate = 12;

    beforeAll(async () => {
      const kas = await findAccount(tenant.id, '1-1000');
      const piutang = await findAccount(tenant.id, '1-1100');
      const pendapatanBunga = await findAccount(tenant.id, '4-1000');
      const pendapatanLain = await findAccount(tenant.id, '4-9000');

      const mappings: Array<[string, string, string]> = [
        ['DISBURSEMENT', piutang.id, kas.id],
        ['PAYMENT_PRINCIPAL', kas.id, piutang.id],
        ['PAYMENT_INTEREST', kas.id, pendapatanBunga.id],
        ['PAYMENT_PENALTY', kas.id, pendapatanLain.id],
      ];

      for (const [transactionKind, debitAccountId, creditAccountId] of mappings) {
        await api
          .put('/api/config/account-mappings')
          .set('Host', `${tenant.slug}.localhost`)
          .set('Cookie', adminCookies)
          .send({ sourceType: 'LOAN_CONFIG', sourceId: loanConfigId, transactionKind, debitAccountId, creditAccountId });
      }
    });

    it('posts a balanced entry on disbursement, debiting Piutang and crediting Kas', async () => {
      const kas = await findAccount(tenant.id, '1-1000');
      const piutang = await findAccount(tenant.id, '1-1100');

      const res = await api
        .post('/api/loans')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, loanConfigId, principalAmount: principal, termMonths });

      expect(res.status).toBe(201);
      loanId = res.body.data.id;

      const entry = await findJournalEntry(tenant.id, 'LOAN_DISBURSEMENT', loanId);
      expect(entry.status).toBe('POSTED');

      const debitLine = entry.lines.find((l) => Number(l.debit) > 0);
      const creditLine = entry.lines.find((l) => Number(l.credit) > 0);
      expect(debitLine?.accountId).toBe(piutang.id);
      expect(Number(debitLine?.debit)).toBe(principal);
      expect(creditLine?.accountId).toBe(kas.id);
    });

    it('splits a payment into principal/interest/penalty lines that still balance overall', async () => {
      const calc = calculateLoan(principal, rate, termMonths, LoanType.KONVENSIONAL, RateType.BUNGA);
      const interestRatio = (calc.totalAmount - principal) / calc.totalAmount;
      const paymentAmount = 100_000;
      const penalty = 5_000;
      const expectedInterest = Math.round(paymentAmount * interestRatio * 100) / 100;
      const expectedPrincipal = Math.round((paymentAmount - expectedInterest) * 100) / 100;

      const today = new Date().toISOString().split('T')[0];
      const res = await api
        .post(`/api/loans/${loanId}/pay`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: paymentAmount, penalty, paidAt: today, dueDate: today });

      expect(res.status).toBe(200);

      const payment = await testPrisma.loanPayment.findFirstOrThrow({ where: { loanId }, orderBy: { createdAt: 'desc' } });
      const entry = await findJournalEntry(tenant.id, 'LOAN_PAYMENT', payment.id);

      expect(entry.status).toBe('POSTED');
      expect(entry.lines.length).toBe(6); // 3 mapped components x 2 lines each

      const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
      const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(totalDebit).toBe(paymentAmount + penalty);
      expect(totalCredit).toBe(paymentAmount + penalty);

      const piutang = await findAccount(tenant.id, '1-1100');
      const pendapatanBunga = await findAccount(tenant.id, '4-1000');
      const pendapatanLain = await findAccount(tenant.id, '4-9000');

      const principalCredit = entry.lines.find((l) => l.accountId === piutang.id);
      const interestCredit = entry.lines.find((l) => l.accountId === pendapatanBunga.id);
      const penaltyCredit = entry.lines.find((l) => l.accountId === pendapatanLain.id);

      expect(Number(principalCredit?.credit)).toBe(expectedPrincipal);
      expect(Number(interestCredit?.credit)).toBe(expectedInterest);
      expect(Number(penaltyCredit?.credit)).toBe(penalty);
    });
  });
});
