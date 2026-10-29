import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { runBillingJobs } from "../src/modules/billing/jobs.js";
import { attachSubscription, daysFrom, invoicesOf, resetCatalog, seedCatalog, subscriptionOf } from "./billing-fixture.js";
import { app, createPlatformAdminSession, DEFAULT_MEMBER, setupTenant } from "./helpers.js";

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  await seedCatalog({ withVat: true });
  clearEntitlementCache();
  vi.stubEnv("PRICING_V2_ENFORCEMENT", "on");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.tenant.deleteMany({});
  await resetCatalog();
});

describe("a subscription's life: renew, fall behind, pay, carry on", () => {
  it("runs end to end through the billing job, the access gate and the owner's payment", async () => {
    const owner = await createPlatformAdminSession();
    const tenant = await setupTenant({ slug: "journey", registrationNo: "KOP-JOURNEY", adminEmail: "admin@journey.test" });
    const api = (path: string) => request(app()).get(path).set("Authorization", `Bearer ${tenant.accessToken}`);
    const create = () =>
      request(app()).post("/api/members").set("Authorization", `Bearer ${tenant.accessToken}`).send({ ...DEFAULT_MEMBER, nik: "3171234567890099" });

    // An active monthly Small subscription whose next bill is 20 days away.
    const now = new Date();
    const due = daysFrom(now, 20);
    const sub = await attachSubscription(tenant.user.tenantId, { packageCode: "small", status: "ACTIVE" });
    await withoutTenantScope(async () =>
      db.tenantSubscription.update({ where: { id: sub.id, tenantId: tenant.user.tenantId }, data: { startsAt: daysFrom(due, -30), nextBillingDate: due } })
    );
    clearEntitlementCache(tenant.user.tenantId);
    expect((await api("/api/members")).status).toBe(200);

    // 1. Within 30 days of the bill, the job issues a renewal invoice with VAT.
    await runBillingJobs(now);
    const [renewal] = (await invoicesOf(tenant.user.tenantId)).filter((i) => i.type === "RENEWAL");
    expect(renewal).toMatchObject({ status: "OPEN" });
    expect(renewal?.total.toString()).toBe("555000");
    expect(renewal?.dueDate.toISOString()).toBe(due.toISOString());

    // 2. Unpaid past the due date plus the 7-day grace period: past due, read-only.
    await runBillingJobs(daysFrom(due, 8));
    expect((await subscriptionOf(tenant.user.tenantId)).status).toBe("PAST_DUE");
    expect((await api("/api/members")).status).toBe(200);
    const blocked = await create();
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe("PAYMENT_REQUIRED");
    const info = await api("/api/config/subscription");
    expect(info.body.data).toMatchObject({ status: "PAST_DUE", openInvoice: { number: renewal!.number, total: "555000.00" } });

    // 3. The owner records the transfer; access is back at once and the cycle moves on one month.
    const paid = await request(app())
      .post(`/api/platform/invoices/${renewal!.id}/mark-paid`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ reference: "TRF-JOURNEY" });
    expect(paid.status).toBe(200);
    expect(await create()).toMatchObject({ status: 201 });
    const after = await subscriptionOf(tenant.user.tenantId);
    expect(after.status).toBe("ACTIVE");
    expect(after.nextBillingDate?.getUTCMonth()).toBe(((due.getUTCMonth() + 1) % 12));
    expect((await api("/api/config/subscription")).body.data.openInvoice).toBeNull();

    // 4. The next cycle bills again, and a repeat run does not double-bill.
    const next = after.nextBillingDate!;
    await runBillingJobs(daysFrom(next, -25));
    await runBillingJobs(daysFrom(next, -24));
    const renewals = (await invoicesOf(tenant.user.tenantId)).filter((i) => i.type === "RENEWAL");
    expect(renewals).toHaveLength(2);
    expect(renewals.filter((i) => i.status === "OPEN")).toHaveLength(1);
  });
});
