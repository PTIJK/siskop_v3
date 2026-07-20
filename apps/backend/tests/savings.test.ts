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
let memberId: string;
let pokokConfigId: string;
let sukarelaConfigId: string;

beforeAll(async () => {
  tenant = await createTestTenant();
  const { superAdminRole, tellerRole } = await createTestRoles(tenant.id);

  await createTestUser(tenant.id, superAdminRole.id, 'admin@savings-test.com');
  await createTestUser(tenant.id, tellerRole.id, 'teller@savings-test.com');

  adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@savings-test.com'));
  tellerCookies = parseCookieHeaders(await loginAs(app, tenant, 'teller@savings-test.com'));

  // Seed saving configs directly
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
  pokokConfigId = pokokConfig.id;

  const sukarelaConfig = await testPrisma.savingConfig.create({
    data: {
      tenantId: tenant.id,
      name: 'Simpanan Sukarela',
      type: 'SUKARELA',
      rateType: 'BUNGA',
      rate: 3.5,
      periodUnit: 'YEARLY',
    },
  });
  sukarelaConfigId = sukarelaConfig.id;

  // Seed member
  const member = await testPrisma.member.create({
    data: {
      tenantId: tenant.id,
      memberId: `KOP-${tenant.slug.toUpperCase()}-${new Date().toISOString().slice(0, 7).replace('-', '')}-0001`,
      accountNumber: `ACC-${Date.now()}`,
      fullName: 'Rina Susanti',
      nik: '3171020202850002',
      address: 'Jl. Pahlawan No. 5, Bandung',
      birthPlace: 'Bandung',
      birthDate: new Date('1985-02-02'),
      occupation: 'Pedagang',
    },
  });
  memberId = member.id;

  // Seed POKOK saving for member
  await testPrisma.saving.create({
    data: {
      tenantId: tenant.id,
      memberId,
      savingConfigId: pokokConfigId,
      balance: 200000,
    },
  });
});

afterAll(async () => {
  await cleanupTenant(tenant.id);
  await testPrisma.$disconnect();
});

describe('Savings Module', () => {
  // ── Config ──────────────────────────────────────────────────────────────────

  describe('GET /api/savings/configs', () => {
    it('returns list of saving configs', async () => {
      const res = await api
        .get('/api/savings/configs')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('POST /api/savings/configs', () => {
    it('creates a new saving config', async () => {
      const res = await api
        .post('/api/savings/configs')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({
          name: 'Simpanan Wajib Test',
          type: 'WAJIB',
          rateType: 'BUNGA',
          rate: 1.5,
          periodUnit: 'MONTHLY',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Simpanan Wajib Test');
      expect(res.body.data.type).toBe('WAJIB');

      // Cleanup inline — leave other configs intact
      await testPrisma.savingConfig.delete({ where: { id: res.body.data.id } });
    });

    it('returns 403 when teller tries to create config', async () => {
      const res = await api
        .post('/api/savings/configs')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies)
        .send({ name: 'Forbidden Config', type: 'SUKARELA', rateType: 'BUNGA', rate: 2, periodUnit: 'YEARLY' });
      expect(res.status).toBe(403);
    });
  });

  // ── Saving accounts ─────────────────────────────────────────────────────────

  let savingId: string;

  describe('POST /api/savings', () => {
    it('creates a new saving account with initialDeposit', async () => {
      const res = await api
        .post('/api/savings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ memberId, savingConfigId: sukarelaConfigId, initialDeposit: 100000 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      savingId = res.body.data.id;
    });

    it('teller can also create saving accounts (savings.create permission)', async () => {
      const res = await api
        .post('/api/savings')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies)
        .send({ memberId, savingConfigId: sukarelaConfigId, initialDeposit: 50000 });
      expect(res.status).toBe(201);
      // cleanup extra saving created by teller
      await testPrisma.savingTransaction.deleteMany({ where: { savingId: res.body.data.id } });
      await testPrisma.saving.delete({ where: { id: res.body.data.id } });
    });
  });

  // ── Deposit ─────────────────────────────────────────────────────────────────

  describe('POST /api/savings/:id/deposit', () => {
    it('accepts deposit and updates balance', async () => {
      const before = await testPrisma.saving.findUnique({ where: { id: savingId } });

      const res = await api
        .post(`/api/savings/${savingId}/deposit`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 50000, note: 'Setoran rutin' });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('DEPOSIT');

      const after = await testPrisma.saving.findUnique({ where: { id: savingId } });
      expect(Number(after!.balance)).toBe(Number(before!.balance) + 50000);
    });

    it('teller can also deposit', async () => {
      const res = await api
        .post(`/api/savings/${savingId}/deposit`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', tellerCookies)
        .send({ amount: 10000 });
      expect(res.status).toBe(201);
    });

    it('rejects zero amount with 422', async () => {
      const res = await api
        .post(`/api/savings/${savingId}/deposit`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 0 });
      expect(res.status).toBe(422);
    });
  });

  // ── Withdraw ────────────────────────────────────────────────────────────────

  describe('POST /api/savings/:id/withdraw', () => {
    it('accepts withdrawal and updates balance', async () => {
      const before = await testPrisma.saving.findUnique({ where: { id: savingId } });

      const res = await api
        .post(`/api/savings/${savingId}/withdraw`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 20000 });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('WITHDRAWAL');

      const after = await testPrisma.saving.findUnique({ where: { id: savingId } });
      expect(Number(after!.balance)).toBe(Number(before!.balance) - 20000);
    });

    it('rejects withdrawal when balance is insufficient', async () => {
      const res = await api
        .post(`/api/savings/${savingId}/withdraw`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 99999999 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('rejects POKOK withdrawal when member has active loan', async () => {
      // Find the POKOK saving seeded in beforeAll
      const pokokSaving = await testPrisma.saving.findFirst({
        where: { memberId, savingConfigId: pokokConfigId },
      });
      if (!pokokSaving) return;

      // Create a fake active loan for this member
      const loanConfig = await testPrisma.loanConfig.create({
        data: {
          tenantId: tenant.id,
          name: 'Pinjaman Test',
          type: 'KONVENSIONAL',
          rateType: 'BUNGA',
          rate: 12,
          maxTermMonths: 24,
        },
      });
      const activeLoan = await testPrisma.loan.create({
        data: {
          tenantId: tenant.id,
          memberId,
          loanConfigId: loanConfig.id,
          principalAmount: 1000000,
          totalAmount: 1120000,
          termMonths: 12,
          monthlyPayment: 93333,
          remainingAmount: 1120000,
          status: 'ACTIVE',
          kolCategory: 'LANCAR',
        },
      });

      const res = await api
        .post(`/api/savings/${pokokSaving.id}/withdraw`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies)
        .send({ amount: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_WITHDRAW_POKOK');

      await testPrisma.loan.delete({ where: { id: activeLoan.id } });
      await testPrisma.loanConfig.delete({ where: { id: loanConfig.id } });
    });
  });

  // ── Transactions ─────────────────────────────────────────────────────────────

  describe('GET /api/savings/:id/transactions', () => {
    it('returns paginated transaction list', async () => {
      const res = await api
        .get(`/api/savings/${savingId}/transactions?page=1&limit=10`)
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  // ── List accounts ────────────────────────────────────────────────────────────

  describe('GET /api/savings', () => {
    it('returns paginated savings list for tenant', async () => {
      const res = await api
        .get('/api/savings?page=1&limit=10')
        .set('Host', `${tenant.slug}.localhost`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
