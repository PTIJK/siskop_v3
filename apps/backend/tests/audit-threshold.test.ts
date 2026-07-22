import request from 'supertest';
import app from '../src/app';
import { checkAuditThreshold } from '../src/lib/audit-threshold';
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

describe('Tenant.modalDisetor config endpoint', () => {
  let tenant: any;
  let adminCookies: string;
  let tellerCookies: string;

  beforeAll(async () => {
    tenant = await createTestTenant();
    const { superAdminRole, tellerRole } = await createTestRoles(tenant.id);
    await createTestUser(tenant.id, superAdminRole.id, 'admin@modal-test.com');
    await createTestUser(tenant.id, tellerRole.id, 'teller@modal-test.com');
    adminCookies = parseCookieHeaders(await loginAs(app, tenant, 'admin@modal-test.com'));
    tellerCookies = parseCookieHeaders(await loginAs(app, tenant, 'teller@modal-test.com'));
  });

  afterAll(async () => {
    await cleanupTenant(tenant.id);
    await testPrisma.$disconnect();
  });

  it('returns null before modalDisetor is set', async () => {
    const res = await api
      .get('/api/config/modal-disetor')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies);

    expect(res.status).toBe(200);
    expect(res.body.data.modalDisetor).toBeNull();
    expect(res.body.data.auditThresholdNotifiedAt).toBeNull();
  });

  it('updates modalDisetor and returns it as a string', async () => {
    const res = await api
      .put('/api/config/modal-disetor')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ modalDisetor: 6_000_000_000 });

    expect(res.status).toBe(200);
    expect(res.body.data.modalDisetor).toBe('6000000000');

    const updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.modalDisetor?.toString()).toBe('6000000000');
  });

  it('rejects a negative value with 422 MODAL_DISETOR_INVALID', async () => {
    const res = await api
      .put('/api/config/modal-disetor')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ modalDisetor: -100 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MODAL_DISETOR_INVALID');
  });

  it('allows clearing modalDisetor back to null', async () => {
    const res = await api
      .put('/api/config/modal-disetor')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', adminCookies)
      .send({ modalDisetor: null });

    expect(res.status).toBe(200);
    expect(res.body.data.modalDisetor).toBeNull();
  });

  it('returns 403 when a teller (no config:update permission) tries to update it', async () => {
    const res = await api
      .put('/api/config/modal-disetor')
      .set('Host', `${tenant.slug}.localhost`)
      .set('Cookie', tellerCookies)
      .send({ modalDisetor: 1000 });

    expect(res.status).toBe(403);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.get('/api/config/modal-disetor').set('Host', `${tenant.slug}.localhost`);
    expect(res.status).toBe(401);
  });
});

describe('checkAuditThreshold', () => {
  let tenant: any;

  afterEach(async () => {
    if (tenant) {
      await cleanupTenant(tenant.id);
      tenant = undefined;
    }
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('does nothing for a tenant below the Rp5M threshold', async () => {
    tenant = await createTestTenant();
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { modalDisetor: 4_999_999_999.99 },
    });

    await checkAuditThreshold(tenant.id);

    const notif = await testPrisma.notification.findFirst({
      where: { type: 'AUDIT_THRESHOLD_EXCEEDED', relatedTenantId: tenant.id },
    });
    expect(notif).toBeNull();
  });

  it('notifies and stamps auditThresholdNotifiedAt for a tenant at/above Rp5M', async () => {
    tenant = await createTestTenant();
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { modalDisetor: 5_000_000_000 },
    });

    await checkAuditThreshold(tenant.id);

    const notif = await testPrisma.notification.findFirst({
      where: { type: 'AUDIT_THRESHOLD_EXCEEDED', relatedTenantId: tenant.id },
    });
    expect(notif).not.toBeNull();
    expect(notif?.message).toContain(tenant.name);

    const updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.auditThresholdNotifiedAt).not.toBeNull();
  });

  it('does not send a second notification within the same calendar year', async () => {
    tenant = await createTestTenant();
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { modalDisetor: 6_000_000_000, auditThresholdNotifiedAt: new Date() },
    });

    await checkAuditThreshold(tenant.id);

    const count = await testPrisma.notification.count({
      where: { type: 'AUDIT_THRESHOLD_EXCEEDED', relatedTenantId: tenant.id },
    });
    expect(count).toBe(0);
  });

  it('re-notifies once auditThresholdNotifiedAt is from a prior calendar year', async () => {
    tenant = await createTestTenant();
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { modalDisetor: 6_000_000_000, auditThresholdNotifiedAt: lastYear },
    });

    await checkAuditThreshold(tenant.id);

    const notif = await testPrisma.notification.findFirst({
      where: { type: 'AUDIT_THRESHOLD_EXCEEDED', relatedTenantId: tenant.id },
    });
    expect(notif).not.toBeNull();

    const updated = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.auditThresholdNotifiedAt?.getFullYear()).toBe(new Date().getFullYear());
  });
});
