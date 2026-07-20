import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export const testPrisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_TEST_URL || process.env.DATABASE_URL,
});

export interface TestContext {
  tenant: any;
  superAdminRole: any;
  managerRole: any;
  tellerRole: any;
  adminUser: any;
  tellerUser: any;
  adminCookies: string[];
  tellerCookies: string[];
}

export function parseCookieHeaders(setCookieHeader: unknown): string {
  const raw = setCookieHeader as string[] | string | undefined;
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

export async function createTestTenant(
  slug = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
) {
  return testPrisma.tenant.create({
    data: {
      name: 'Koperasi Test',
      slug,
      address: 'Jl. Test No. 1, Jakarta',
      registrationNo: `REG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'KONVENSIONAL',
      isActive: true,
    },
  });
}

export async function createTestRoles(tenantId: string) {
  const fullPerms = {
    dashboard: { read: true },
    members: { create: true, read: true, update: true, delete: true },
    savings: { create: true, read: true, update: true, delete: true },
    loans: { create: true, read: true, update: true, delete: true },
    reports: { read: true, export: true },
    config: { read: true, update: true },
    users: { create: true, read: true, update: true, delete: true },
    roles: { create: true, read: true, update: true, delete: true },
  };
  const tellerPerms = {
    dashboard: { read: true },
    members: { create: false, read: true, update: false, delete: false },
    savings: { create: true, read: true, update: true, delete: false },
    loans: { create: false, read: true, update: true, delete: false },
    reports: { read: false, export: false },
    config: { read: false, update: false },
    users: { create: false, read: false, update: false, delete: false },
    roles: { create: false, read: false, update: false, delete: false },
  };

  const superAdminRole = await testPrisma.role.create({
    data: { tenantId, name: 'Super Admin', permissions: fullPerms },
  });
  const tellerRole = await testPrisma.role.create({
    data: { tenantId, name: 'Teller', permissions: tellerPerms },
  });
  return { superAdminRole, tellerRole };
}

export async function createTestUser(
  tenantId: string,
  roleId: string,
  email: string,
  extra: Record<string, any> = {}
) {
  return testPrisma.user.create({
    data: {
      tenantId,
      roleId,
      email,
      passwordHash: await bcrypt.hash('Test123!', 10),
      name: 'Test User',
      isActive: true,
      ...extra,
    },
  });
}

export async function loginAs(
  app: any,
  tenant: any,
  email: string,
  password = 'Test123!'
): Promise<string[]> {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Host', `${tenant.slug}.localhost`)
    .send({ email, password });
  return res.headers['set-cookie'] as unknown as string[];
}

export async function cleanupTenant(tenantId: string) {
  await testPrisma.loanPayment.deleteMany({ where: { tenantId } });
  await testPrisma.loan.deleteMany({ where: { tenantId } });
  await testPrisma.savingTransaction.deleteMany({ where: { tenantId } });
  await testPrisma.saving.deleteMany({ where: { tenantId } });
  await testPrisma.savingConfig.deleteMany({ where: { tenantId } });
  await testPrisma.loanConfig.deleteMany({ where: { tenantId } });
  await testPrisma.member.deleteMany({ where: { tenantId } });
  await testPrisma.refreshToken.deleteMany({ where: { user: { tenantId } } });
  await testPrisma.user.deleteMany({ where: { tenantId } });
  await testPrisma.role.deleteMany({ where: { tenantId } });
  await testPrisma.tenant.delete({ where: { id: tenantId } });
}
