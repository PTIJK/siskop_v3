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
let adminCookies: string;
let tellerCookies: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  const { superAdminRole, tellerRole } = await createTestRoles(tenant.id);

  await createTestUser(tenant.id, superAdminRole.id, 'admin@dashboard-test.com');
  await createTestUser(tenant.id, tellerRole.id, 'teller@dashboard-test.com');

  adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@dashboard-test.com'));
  tellerCookies = parseCookieHeaders(await loginAs(app, tenant, 'teller@dashboard-test.com'));

  // Seed minimal data for stats to exist
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

  const loanConfig = await testPrisma.loanConfig.create({
    data: {
      tenantId: tenant.id,
      name: 'Pinjaman Reguler',
      type: 'KONVENSIONAL',
      rateType: 'BUNGA',
      rate: 12,
      maxTermMonths: 24,
    },
  });

  const member = await testPrisma.member.create({
    data: {
      tenantId: tenant.id,
      memberId: `KOP-DASH-202501-0001`,
      accountNumber: `ACC-DASH${Date.now()}`,
      fullName: 'Dewi Lestari',
      nik: '3171040404800004',
      address: 'Jl. Dahlia No. 4, Medan',
      birthPlace: 'Medan',
      birthDate: new Date('1980-04-04'),
      occupation: 'Petani',
    },
  });

  await testPrisma.saving.create({
    data: { tenantId: tenant.id, memberId: member.id, savingConfigId: pokokConfig.id, balance: 300_000 },
  });

  await testPrisma.loan.create({
    data: {
      tenantId: tenant.id,
      memberId: member.id,
      loanConfigId: loanConfig.id,
      principalAmount: 2_000_000,
      totalAmount: 2_240_000,
      termMonths: 12,
      monthlyPayment: 186_667,
      remainingAmount: 2_240_000,
      status: 'ACTIVE',
      kolCategory: 'LANCAR',
    },
  });
});

afterAll(async () => {
  await cleanupTenant(tenant.id);
  await testPrisma.$disconnect();
});

describe('Dashboard Module', () => {
  describe('GET /api/dashboard/summary', () => {
    it('returns summary stats for the tenant', async () => {
      const res = await api
        .get('/api/dashboard/summary')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.memberCount).toBe('number');
      expect(res.body.data.totalSavings).toBeDefined();
      expect(res.body.data.totalActiveLoans).toBeDefined();
    });

    it('teller can also read dashboard summary', async () => {
      const res = await api
        .get('/api/dashboard/summary')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies);
      expect(res.status).toBe(200);
    });

    it('returns 401 without authentication', async () => {
      const res = await api
        .get('/api/dashboard/summary')
        .set('Host', `${tenant.slug}.localhost`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/dashboard/loan-chart', () => {
    it('returns loan chart data', async () => {
      const res = await api
        .get('/api/dashboard/loan-chart')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/dashboard/payment-chart', () => {
    it('returns payment chart data', async () => {
      const res = await api
        .get('/api/dashboard/payment-chart')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
