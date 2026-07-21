import { addDays, subDays } from 'date-fns';
import { processBillingReminders } from '../src/lib/billing';
import {
  testPrisma,
  createTestTenant,
  createTestRoles,
  createTestUser,
  cleanupTenant,
} from './helpers/setup';

describe('processBillingReminders', () => {
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('blocks tenant access once nextBillingDate has passed', async () => {
    const tenant = await createTestTenant();
    const { superAdminRole } = await createTestRoles(tenant.id);
    await createTestUser(tenant.id, superAdminRole.id, 'overdue@billing-test.com');
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { nextBillingDate: subDays(new Date(), 1) },
    });

    await processBillingReminders(tenant.id);

    const updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.isActive).toBe(false);

    await cleanupTenant(tenant.id);
  });

  it('sends a 30-day reminder exactly once', async () => {
    const tenant = await createTestTenant();
    const { superAdminRole } = await createTestRoles(tenant.id);
    await createTestUser(tenant.id, superAdminRole.id, 'reminder30@billing-test.com');
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { nextBillingDate: addDays(new Date(), 30) },
    });

    await processBillingReminders(tenant.id);
    let updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.billingReminder30SentAt).not.toBeNull();
    expect(updated?.isActive).toBe(true);
    const sentAtFirstRun = updated!.billingReminder30SentAt!.getTime();

    await processBillingReminders(tenant.id);
    updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.billingReminder30SentAt?.getTime()).toBe(sentAtFirstRun);

    await cleanupTenant(tenant.id);
  });

  it('sends a 7-day reminder', async () => {
    const tenant = await createTestTenant();
    const { superAdminRole } = await createTestRoles(tenant.id);
    await createTestUser(tenant.id, superAdminRole.id, 'reminder7@billing-test.com');
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { nextBillingDate: addDays(new Date(), 7) },
    });

    await processBillingReminders(tenant.id);
    const updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.billingReminder7SentAt).not.toBeNull();
    expect(updated?.isActive).toBe(true);

    await cleanupTenant(tenant.id);
  });

  it('leaves tenants without a billing date untouched', async () => {
    const tenant = await createTestTenant();

    await processBillingReminders(tenant.id);

    const updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.isActive).toBe(true);
    expect(updated?.nextBillingDate).toBeNull();

    await cleanupTenant(tenant.id);
  });
});
