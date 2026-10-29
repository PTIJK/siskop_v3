import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { clearEntitlementCache, getTenantEntitlements } from "../src/lib/pricing/entitlements.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { runBillingJobs } from "../src/modules/billing/jobs.js";
import { cleanBilling, daysFrom, invoicesOf, makeSubscribedTenant, seedCatalog, subscriptionOf } from "./billing-fixture.js";

const NOW = new Date("2026-03-10T00:00:00.000Z");

beforeAll(() => {
  if (!new URL(process.env.DATABASE_URL ?? "postgresql://localhost/missing").pathname.endsWith("_test"))
    throw new Error("Use a dedicated database ending in _test for these integration tests");
});
beforeEach(async () => {
  await cleanBilling();
  await seedCatalog({ withVat: true });
  clearEntitlementCache();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await cleanBilling();
  await db.$disconnect();
});

function stubResend() {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
  vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    })
  );
  return sent;
}

/** An active monthly Small subscription whose next billing date is `inDays` after NOW. */
const active = (tag: string, inDays: number, extra: Parameters<typeof makeSubscribedTenant>[0] extends infer T ? Partial<T> : never = {}) =>
  makeSubscribedTenant({
    tag,
    status: "ACTIVE",
    cycle: "MONTHLY",
    startsAt: daysFrom(NOW, inDays - 30),
    nextBillingDate: daysFrom(NOW, inDays),
    invoice: null,
    ...extra
  });

const renewals = async (tenantId: string) => (await invoicesOf(tenantId)).filter((i) => i.type === "RENEWAL");

describe("renewal invoicing", () => {
  it("issues a renewal invoice 30 days before the billing date, VAT included", async () => {
    const { tenant, subscription } = await active("R1", 26);

    const result = await runBillingJobs(NOW);

    expect(result.renewals).toMatchObject({ created: 1, failed: 0 });
    const [invoice] = await renewals(tenant.id);
    expect(invoice).toMatchObject({ status: "OPEN", subscriptionId: subscription.id });
    expect(invoice?.dueDate.toISOString()).toBe(subscription.nextBillingDate!.toISOString());
    expect(invoice?.subtotal.toString()).toBe("500000");
    expect(invoice?.taxRate?.toString()).toBe("0.11");
    expect(invoice?.taxAmount.toString()).toBe("55000");
    expect(invoice?.total.toString()).toBe("555000");
    expect(invoice?.number).toMatch(/^INV-202603-\d{4}$/);
  });

  it("waits until the invoice is within 30 days of the billing date", async () => {
    const { tenant } = await active("R2", 41);
    expect((await runBillingJobs(NOW)).renewals.created).toBe(0);
    expect(await renewals(tenant.id)).toHaveLength(0);
  });

  it("is safe to run again: one invoice per billing date", async () => {
    const { tenant } = await active("R3", 20);
    await runBillingJobs(NOW);
    const second = await runBillingJobs(daysFrom(NOW, 1));
    expect(second.renewals.created).toBe(0);
    expect(await renewals(tenant.id)).toHaveLength(1);
  });

  it("issues a fresh invoice after the old one was voided", async () => {
    const { tenant } = await active("R4", 20);
    await runBillingJobs(NOW);
    await withoutTenantScope(async () => db.invoice.updateMany({ where: { tenantId: tenant.id }, data: { status: "VOID" } }));
    await runBillingJobs(daysFrom(NOW, 1));
    expect(await renewals(tenant.id)).toHaveLength(2);
  });

  it("never bills free, cancelled or unpaid-registration subscriptions", async () => {
    const free = await makeSubscribedTenant({ tag: "R5A", packageCode: "free", status: "ACTIVE", nextBillingDate: null, invoice: null });
    const cancelled = await active("R5B", 5, { status: "CANCELLED" });
    const pending = await active("R5C", 5, { status: "PENDING_PAYMENT" });
    const result = await runBillingJobs(NOW);
    expect(result.renewals.created).toBe(0);
    for (const t of [free, cancelled, pending]) expect(await renewals(t.tenant.id)).toHaveLength(0);
  });

  it("a yearly subscription's renewal includes the yearly support fee", async () => {
    const { tenant } = await active("R6", 20, { cycle: "YEARLY", supportPlanCode: "SP1" });
    await runBillingJobs(NOW);
    const [invoice] = await renewals(tenant.id);
    expect(invoice?.subtotal.toString()).toBe("10000000"); // 5.000.000 package + 5.000.000 support
  });

  it("a monthly subscription pays support only on the anniversary month", async () => {
    // Started 11 months before the billing date: no support. Started 12 months before: support.
    const mid = await active("R7A", 20, { supportPlanCode: "SP1", startsAt: new Date("2025-04-30T00:00:00.000Z") });
    const anniversary = await active("R7B", 20, { supportPlanCode: "SP1", startsAt: new Date("2025-03-30T00:00:00.000Z") });
    await runBillingJobs(NOW);
    expect((await renewals(mid.tenant.id))[0]?.subtotal.toString()).toBe("500000");
    expect((await renewals(anniversary.tenant.id))[0]?.subtotal.toString()).toBe("5500000");
  });

  it("a free package with paid support is billed the support fee alone", async () => {
    const { tenant } = await active("R8", 20, { packageCode: "free", cycle: "YEARLY", supportPlanCode: "SP1" });
    await runBillingJobs(NOW);
    expect((await renewals(tenant.id))[0]?.subtotal.toString()).toBe("5000000");
  });

  it("charges the frozen subscription price, not the current catalog price", async () => {
    const { tenant } = await active("R9", 20);
    await db.subscriptionPackage.update({ where: { code: "small" }, data: { priceMonthly: 900000 } });
    await runBillingJobs(NOW);
    expect((await renewals(tenant.id))[0]?.subtotal.toString()).toBe("500000");
  });
});

describe("renewal notices", () => {
  it("emails the invoice when it is issued", async () => {
    const sent = stubResend();
    const { tenant, admin } = await active("N1", 26);
    await runBillingJobs(NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual([admin.email]);
    const [invoice] = await renewals(tenant.id);
    expect(sent[0]?.subject).toContain(invoice!.number);
    expect(invoice?.noticeStage).toBe(1);
  });

  it("sends the 7-day reminder once, and never repeats the invoice mail", async () => {
    const sent = stubResend();
    await active("N2", 26);
    await runBillingJobs(NOW);
    await runBillingJobs(daysFrom(NOW, 10)); // 16 days left: nothing new
    expect(sent).toHaveLength(1);

    await runBillingJobs(daysFrom(NOW, 20)); // 6 days left
    expect(sent).toHaveLength(2);
    expect(sent[1]?.subject).toMatch(/Pengingat/);

    await runBillingJobs(daysFrom(NOW, 21));
    expect(sent).toHaveLength(2);
  });

  it("does not remind about an invoice that was paid", async () => {
    const sent = stubResend();
    const { tenant } = await active("N3", 26);
    await runBillingJobs(NOW);
    await withoutTenantScope(async () => db.invoice.updateMany({ where: { tenantId: tenant.id }, data: { status: "PAID" } }));
    await runBillingJobs(daysFrom(NOW, 22));
    expect(sent).toHaveLength(1);
  });

  it("keeps the invoice and retries the mail next run when email fails", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
    vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { tenant } = await active("N4", 26);

    const result = await runBillingJobs(NOW);

    expect(result.renewals.created).toBe(1);
    expect(result.renewals.failed).toBe(0);
    expect((await renewals(tenant.id))[0]?.noticeStage).toBe(0);
  });
});

describe("past due", () => {
  const overdue = (tag: string, dueAgoDays: number) =>
    active(tag, -dueAgoDays, { invoice: { type: "RENEWAL", dueDate: daysFrom(NOW, -dueAgoDays) }, isActive: true });

  it("marks a subscription past due once the grace period after the due date is over", async () => {
    const { tenant } = await overdue("P1", 8); // grace is 7 days
    const result = await runBillingJobs(NOW);
    expect(result.pastDue.marked).toBe(1);
    expect((await subscriptionOf(tenant.id)).status).toBe("PAST_DUE");
    expect((await db.notification.findMany({ where: { relatedTenantId: tenant.id } })).map((n) => n.type)).toEqual(["BILLING_BLOCKED"]);
  });

  it("leaves it active while still inside the grace period", async () => {
    const { tenant } = await overdue("P2", 6);
    await runBillingJobs(NOW);
    expect((await subscriptionOf(tenant.id)).status).toBe("ACTIVE");
  });

  it("refreshes cached entitlements and does not notify twice", async () => {
    const { tenant } = await overdue("P3", 9);
    expect((await getTenantEntitlements(tenant.id))?.status).toBe("ACTIVE");
    await runBillingJobs(NOW);
    expect((await getTenantEntitlements(tenant.id))?.status).toBe("PAST_DUE");
    await runBillingJobs(daysFrom(NOW, 1));
    expect(await db.notification.count({ where: { relatedTenantId: tenant.id } })).toBe(1);
  });

  it("does not deactivate the tenant itself: blocking is the enforcement layer's job", async () => {
    const { tenant } = await overdue("P4", 9);
    await runBillingJobs(NOW);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).isActive).toBe(true);
  });
});

describe("unpaid registration purge", () => {
  const unpaid = (tag: string, dueInDays: number, extra: Partial<Parameters<typeof makeSubscribedTenant>[0]> = {}) =>
    makeSubscribedTenant({ tag, invoice: { dueDate: daysFrom(NOW, dueInDays) }, ...extra });
  const exists = async (tenantId: string) => (await db.tenant.findUnique({ where: { id: tenantId } })) !== null;

  it("deletes a koperasi whose registration invoice went unpaid past its deadline", async () => {
    const { tenant } = await unpaid("U1", -1);
    const result = await runBillingJobs(NOW);
    expect(result.purge).toMatchObject({ deleted: 1, failed: 0 });
    expect(await exists(tenant.id)).toBe(false);
    expect(await withoutTenantScope(async () => db.invoice.count({ where: { tenantId: tenant.id } }))).toBe(0);
  });

  it("keeps one that still has time to pay", async () => {
    const { tenant } = await unpaid("U2", 3);
    await runBillingJobs(NOW);
    expect(await exists(tenant.id)).toBe(true);
  });

  it("keeps one that has paid, even if some invoice is still open", async () => {
    const { tenant } = await unpaid("U3", -5, { status: "ACTIVE", isActive: true });
    await runBillingJobs(NOW);
    expect(await exists(tenant.id)).toBe(true);
  });

  it("keeps a koperasi an admin created or migrated, and one with no subscription at all", async () => {
    const admin = await unpaid("U4", -5, { createdVia: "ADMIN" });
    const migrated = await unpaid("U5", -5, { createdVia: "MIGRATION" });
    const legacy = await makeSubscribedTenant({ tag: "U6", invoice: null });
    await withoutTenantScope(async () => db.tenantSubscription.deleteMany({ where: { tenantId: legacy.tenant.id } }));
    await runBillingJobs(NOW);
    for (const t of [admin, migrated, legacy]) expect(await exists(t.tenant.id)).toBe(true);
  });

  it("uses the invoice's own deadline, which the owner extends by reissuing", async () => {
    const { tenant, invoice } = await unpaid("U7", -1);
    await withoutTenantScope(async () => db.invoice.update({ where: { id: invoice!.id, tenantId: tenant.id }, data: { dueDate: daysFrom(NOW, 14) } }));
    await runBillingJobs(NOW);
    expect(await exists(tenant.id)).toBe(true);
  });
});
