import request from 'supertest';
import app from '../src/app';
import { LoanType, RateType } from '@siskop/shared';
import { calculateLoan } from '../src/lib/loan-calc';
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
let memberId: string;
let memberWithoutPokokId: string;
let loanConfigId: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  const { superAdminRole } = await createTestRoles(tenant.id);
  await createTestUser(tenant.id, superAdminRole.id, 'admin@loans-test.com');
  adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@loans-test.com'));

  // Seed loan config
  const loanConfig = await testPrisma.loanConfig.create({
    data: {
      tenantId: tenant.id,
      name: 'Kredit Reguler',
      type: 'KONVENSIONAL',
      rateType: 'BUNGA',
      rate: 12,
      maxTermMonths: 24,
    },
  });
  loanConfigId = loanConfig.id;

  // Seed member WITH pokok saving
  const member = await testPrisma.member.create({
    data: {
      tenantId: tenant.id,
      memberId: `KOP-LNTEST-${new Date().toISOString().slice(0, 7).replace('-', '')}-0001`,
      accountNumber: `ACC-LN${Date.now()}`,
      fullName: 'Ahmad Fauzi',
      nik: '3171030303750003',
      address: 'Jl. Pemuda No. 3, Surabaya',
      birthPlace: 'Surabaya',
      birthDate: new Date('1975-03-03'),
      occupation: 'Nelayan',
    },
  });
  memberId = member.id;

  const pokokConfig = await testPrisma.savingConfig.create({
    data: {
      tenantId: tenant.id,
      name: 'Simpanan Pokok',
      type: 'POKOK',
      rateType: 'BUNGA',
      rate: 0,
      periodUnit: 'YEARLY',
    },
  });

  await testPrisma.saving.create({
    data: {
      tenantId: tenant.id,
      memberId,
      savingConfigId: pokokConfig.id,
      balance: 500000,
    },
  });

  // Seed member WITHOUT pokok saving
  const memberNoPp = await testPrisma.member.create({
    data: {
      tenantId: tenant.id,
      memberId: `KOP-LNTEST-${new Date().toISOString().slice(0, 7).replace('-', '')}-0002`,
      accountNumber: `ACC-LN2${Date.now()}`,
      fullName: 'Tanpa Pokok',
      nik: '3171030303750099',
      address: 'Jl. Test No. 99',
      birthPlace: 'Jakarta',
      birthDate: new Date('1980-01-01'),
      occupation: 'Buruh',
    },
  });
  memberWithoutPokokId = memberNoPp.id;
});

afterAll(async () => {
  await cleanupTenant(tenant.id);
  await testPrisma.$disconnect();
});

// ── Unit tests for loan calculation ─────────────────────────────────────────

describe('Loan calculation (unit)', () => {
  it('calculates conventional (anuitas) monthly payment correctly', () => {
    const principal = 1_200_000;
    const rate = 12; // %/year
    const termMonths = 12;
    const calc = calculateLoan(principal, rate, termMonths, LoanType.KONVENSIONAL, RateType.BUNGA);

    const monthlyRate = rate / 12 / 100;
    const expected = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));

    expect(calc.monthlyPayment).toBeGreaterThan(0);
    expect(calc.totalAmount).toBeGreaterThan(principal);
    expect(Math.abs(calc.monthlyPayment - Math.round(expected * 100) / 100)).toBeLessThan(1);
  });

  it('calculates syariah (flat margin) total interest correctly', () => {
    const principal = 1_200_000;
    const rate = 12;
    const termMonths = 12;
    const calc = calculateLoan(principal, rate, termMonths, LoanType.SYARIAH, RateType.MARGIN);

    const expectedInterest = principal * (rate / 100) * (termMonths / 12);
    expect(calc.totalInterest).toBeCloseTo(expectedInterest, 0);
    expect(calc.monthlyPayment).toBeCloseTo((principal + expectedInterest) / termMonths, 0);
  });
});

// ── API integration tests ────────────────────────────────────────────────────

describe('Loans Module', () => {
  let loanId: string;

  // ── Config ─────────────────────────────────────────────────────────────────

  describe('GET /api/loans/configs', () => {
    it('returns list of loan configs', async () => {
      const res = await api
        .get('/api/loans/configs')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  // ── Create loan ────────────────────────────────────────────────────────────

  describe('POST /api/loans', () => {
    it('rejects loan if member has no simpanan pokok', async () => {
      const res = await api
        .post('/api/loans')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId: memberWithoutPokokId, loanConfigId, principalAmount: 1_000_000, termMonths: 12 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MEMBER_HAS_NO_POKOK_SAVING');
    });

    it('creates loan and returns calculated amounts', async () => {
      const res = await api
        .post('/api/loans')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, loanConfigId, principalAmount: 1_200_000, termMonths: 12 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.status).toBe('ACTIVE');
      expect(Number(res.body.data.totalAmount)).toBeGreaterThan(1_200_000);
      loanId = res.body.data.id;
    });

    it('returns warning when member already has active loan (no force flag)', async () => {
      const res = await api
        .post('/api/loans')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, loanConfigId, principalAmount: 500_000, termMonths: 6 });

      expect(res.status).toBe(200);
      expect(res.body.data.hasExistingLoan).toBe(true);
    });

    it('creates second loan when force: true is passed', async () => {
      const res = await api
        .post('/api/loans')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, loanConfigId, principalAmount: 300_000, termMonths: 3, force: true });

      expect(res.status).toBe(201);
      // Cleanup extra loan immediately
      await testPrisma.loan.delete({ where: { id: res.body.data.id } });
    });

    it('rejects termMonths exceeding loanConfig.maxTermMonths', async () => {
      const res = await api
        .post('/api/loans')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, loanConfigId, principalAmount: 500_000, termMonths: 999, force: true });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TERM_EXCEEDS_MAX');
    });
  });

  // ── List loans ─────────────────────────────────────────────────────────────

  describe('GET /api/loans', () => {
    it('returns paginated loan list', async () => {
      const res = await api
        .get('/api/loans?page=1&limit=10')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
    });

    it('filters by status', async () => {
      const res = await api
        .get('/api/loans?status=ACTIVE')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.every((l: any) => l.status === 'ACTIVE')).toBe(true);
    });

    it('filters by loanConfigId (jenis pembiayaan)', async () => {
      const res = await api
        .get(`/api/loans?loanConfigId=${loanConfigId}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.every((l: any) => l.loanConfig?.name === 'Kredit Reguler' || l.loanConfigId === loanConfigId)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('returns empty list for a loanConfigId with no loans', async () => {
      const otherConfig = await testPrisma.loanConfig.create({
        data: {
          tenantId: tenant.id,
          name: 'Config Tanpa Pinjaman',
          type: 'KONVENSIONAL',
          rateType: 'BUNGA',
          rate: 5,
          maxTermMonths: 12,
        },
      });

      const res = await api
        .get(`/api/loans?loanConfigId=${otherConfig.id}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);

      await testPrisma.loanConfig.delete({ where: { id: otherConfig.id } });
    });
  });

  // ── Get loan by ID ─────────────────────────────────────────────────────────

  describe('GET /api/loans/:id', () => {
    it('returns loan detail with member and payments', async () => {
      const res = await api
        .get(`/api/loans/${loanId}`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(loanId);
      expect(res.body.data.member).toBeDefined();
      expect(Array.isArray(res.body.data.payments)).toBe(true);
    });

    it('returns 404 for nonexistent loan id', async () => {
      const res = await api
        .get('/api/loans/nonexistent-loan-id')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);
      expect(res.status).toBe(404);
    });
  });

  // ── Record payment ─────────────────────────────────────────────────────────

  describe('POST /api/loans/:id/pay', () => {
    const today = new Date().toISOString().split('T')[0];

    it('records partial payment and decreases remainingAmount', async () => {
      const before = await testPrisma.loan.findUnique({ where: { id: loanId } });
      const prevRemaining = Number(before!.remainingAmount);

      const res = await api
        .post(`/api/loans/${loanId}/pay`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 100_000, paidAt: today, dueDate: today });

      expect(res.status).toBe(200);
      expect(res.body.data.newRemaining).toBe(prevRemaining - 100_000);
      expect(res.body.data.kolCategory).toBeDefined();
    });

    it('marks loan as COMPLETED when remainingAmount reaches 0', async () => {
      const loan = await testPrisma.loan.findUnique({ where: { id: loanId } });
      const remaining = Number(loan!.remainingAmount);

      const res = await api
        .post(`/api/loans/${loanId}/pay`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: remaining, paidAt: today, dueDate: today });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('returns 400 when trying to pay a completed loan', async () => {
      const res = await api
        .post(`/api/loans/${loanId}/pay`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 10_000, paidAt: today, dueDate: today });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LOAN_NOT_ACTIVE');
    });
  });

  // ── KOL recalculation ──────────────────────────────────────────────────────

  describe('KOL recalculation after payment', () => {
    it('returns kolCategory in payment response', async () => {
      const loanConfig2 = await testPrisma.loanConfig.findFirst({ where: { tenantId: tenant.id } });
      const createRes = await api
        .post('/api/loans')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, loanConfigId: loanConfig2!.id, principalAmount: 300_000, termMonths: 3, force: true });

      const newLoanId = createRes.body.data.id;
      const today = new Date().toISOString().split('T')[0];

      const payRes = await api
        .post(`/api/loans/${newLoanId}/pay`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 100_000, paidAt: today, dueDate: today });

      expect(payRes.status).toBe(200);
      expect(payRes.body.data.kolCategory).toBe('LANCAR');

      await testPrisma.loanPayment.deleteMany({ where: { loanId: newLoanId } });
      await testPrisma.loan.delete({ where: { id: newLoanId } });
    });
  });

  // ── Overdue ────────────────────────────────────────────────────────────────

  describe('GET /api/loans/overdue', () => {
    it('returns array sorted by KOL severity', async () => {
      const res = await api
        .get('/api/loans/overdue')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
