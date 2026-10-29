import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";
import { getAdapter, PaymentGatewayNotConnectedError } from "../src/lib/payments/adapters.js";
import { confirmPayment } from "../src/lib/payments/confirm.js";
import { addCycle } from "../src/lib/pricing/billing-dates.js";
import { clearEntitlementCache, getTenantEntitlements } from "../src/lib/pricing/entitlements.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { cleanBilling, daysFrom, invoicesOf, makeSubscribedTenant, paymentsOf, seedCatalog, subscriptionOf } from "./billing-fixture.js";

beforeAll(() => {
  if (!new URL(process.env.DATABASE_URL ?? "postgresql://localhost/missing").pathname.endsWith("_test"))
    throw new Error("Use a dedicated database ending in _test for these integration tests");
});
beforeEach(async () => {
  await cleanBilling();
  await seedCatalog();
  clearEntitlementCache();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await cleanBilling();
  await db.$disconnect();
});

const NOW = new Date("2026-03-10T08:00:00.000Z");

describe("addCycle", () => {
  it("adds a month and clamps to the end of a shorter month", () => {
    expect(addCycle(new Date("2026-01-31T00:00:00.000Z"), "MONTHLY").toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("keeps the original day of month as the anchor, so Feb 28 does not drift the schedule", () => {
    const next = addCycle(new Date("2026-02-28T00:00:00.000Z"), "MONTHLY", 31);
    expect(next.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("adds a year, and handles a leap day", () => {
    expect(addCycle(new Date("2026-03-15T00:00:00.000Z"), "YEARLY").toISOString()).toBe("2027-03-15T00:00:00.000Z");
    expect(addCycle(new Date("2028-02-29T00:00:00.000Z"), "YEARLY").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});

describe("confirmPayment: registration invoice", () => {
  it("marks the invoice paid, records the payment, activates the subscription and the tenant", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "A1", packageCode: "small", cycle: "MONTHLY" });

    const result = await confirmPayment(invoice!.id, { method: "BANK_TRANSFER", gatewayTxnId: "TRF-001", now: NOW });

    expect(result.alreadyPaid).toBe(false);
    expect((await invoicesOf(tenant.id))[0]?.status).toBe("PAID");
    const [payment] = await paymentsOf(tenant.id);
    expect(payment).toMatchObject({ method: "BANK_TRANSFER", gatewayTxnId: "TRF-001", invoiceId: invoice!.id });
    expect(payment?.amount.toString()).toBe(invoice!.total.toString());
    expect(payment?.paidAt.toISOString()).toBe(NOW.toISOString());

    const sub = await subscriptionOf(tenant.id);
    expect(sub.status).toBe("ACTIVE");
    expect(sub.startsAt.toISOString()).toBe(NOW.toISOString());
    expect(sub.nextBillingDate?.toISOString()).toBe("2026-04-10T08:00:00.000Z");
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).isActive).toBe(true);
  });

  it("sets a yearly subscription's next billing date one year out", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "A2", packageCode: "small", cycle: "YEARLY" });
    await confirmPayment(invoice!.id, { now: NOW });
    expect((await subscriptionOf(tenant.id)).nextBillingDate?.toISOString()).toBe("2027-03-10T08:00:00.000Z");
  });

  it("bills a free package with paid support once a year, whatever cycle was picked", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "A3", packageCode: "free", cycle: "MONTHLY", supportPlanCode: "SP1" });
    await confirmPayment(invoice!.id, { now: NOW });
    expect((await subscriptionOf(tenant.id)).nextBillingDate?.toISOString()).toBe("2027-03-10T08:00:00.000Z");
  });

  it("tells the platform owners the koperasi is registered", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "A4" });
    await confirmPayment(invoice!.id, { now: NOW });
    const notes = await db.notification.findMany({ where: { relatedTenantId: tenant.id } });
    expect(notes.map((n) => n.type)).toEqual(["TENANT_REGISTERED"]);
  });

  it("refreshes cached entitlements so the new status shows at once", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "A5" });
    expect((await getTenantEntitlements(tenant.id))?.status).toBe("PENDING_PAYMENT");
    await confirmPayment(invoice!.id, { now: NOW });
    expect((await getTenantEntitlements(tenant.id))?.status).toBe("ACTIVE");
  });

  it("records who confirmed it in the audit trail", async () => {
    const { invoice } = await makeSubscribedTenant({ tag: "A6" });
    await confirmPayment(invoice!.id, { confirmedBy: "owner-1", now: NOW });
    const rows = await db.pricingAuditLog.findMany({ where: { entity: "invoice", entityId: invoice!.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: "owner-1", action: "PAID" });
  });
});

describe("confirmPayment: idempotency and refusals", () => {
  it("a second call changes nothing and reports alreadyPaid", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "B1" });
    await confirmPayment(invoice!.id, { now: NOW });
    const before = await subscriptionOf(tenant.id);

    const again = await confirmPayment(invoice!.id, { now: daysFrom(NOW, 5) });

    expect(again.alreadyPaid).toBe(true);
    expect(await paymentsOf(tenant.id)).toHaveLength(1);
    const after = await subscriptionOf(tenant.id);
    expect(after.nextBillingDate?.toISOString()).toBe(before.nextBillingDate?.toISOString());
    expect(await db.notification.count({ where: { relatedTenantId: tenant.id } })).toBe(1);
  });

  it("simultaneous confirmations record exactly one payment", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "B2" });
    const results = await Promise.all([1, 2, 3, 4].map(() => confirmPayment(invoice!.id, { now: NOW })));
    expect(results.filter((r) => !r.alreadyPaid)).toHaveLength(1);
    expect(await paymentsOf(tenant.id)).toHaveLength(1);
  });

  it("refuses a void invoice", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "B3", invoice: { status: "VOID" } });
    await expect(confirmPayment(invoice!.id, { now: NOW })).rejects.toThrow(/CONFLICT/);
    expect(await paymentsOf(tenant.id)).toHaveLength(0);
    expect((await subscriptionOf(tenant.id)).status).toBe("PENDING_PAYMENT");
  });

  it("refuses an expired invoice: the owner reissues it instead", async () => {
    const { invoice } = await makeSubscribedTenant({ tag: "B4", invoice: { status: "EXPIRED" } });
    await expect(confirmPayment(invoice!.id, { now: NOW })).rejects.toThrow(/CONFLICT/);
  });

  it("reports an unknown invoice as not found", async () => {
    await expect(confirmPayment("missing-id", { now: NOW })).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("confirmPayment: renewal invoice", () => {
  it("moves the billing date forward from the old date, not from the payment date", async () => {
    const due = new Date("2026-03-20T08:00:00.000Z");
    const { tenant, invoice } = await makeSubscribedTenant({
      tag: "C1",
      status: "ACTIVE",
      cycle: "MONTHLY",
      startsAt: new Date("2026-02-20T08:00:00.000Z"),
      nextBillingDate: due,
      invoice: { type: "RENEWAL", dueDate: due }
    });

    await confirmPayment(invoice!.id, { now: NOW }); // paid ten days early

    const sub = await subscriptionOf(tenant.id);
    expect(sub.nextBillingDate?.toISOString()).toBe("2026-04-20T08:00:00.000Z");
    expect(sub.startsAt.toISOString()).toBe("2026-02-20T08:00:00.000Z");
    expect(await db.notification.count({ where: { relatedTenantId: tenant.id } })).toBe(0);
  });

  it("lifts the past-due state and reactivates the tenant", async () => {
    const due = new Date("2026-02-20T08:00:00.000Z");
    const { tenant, invoice } = await makeSubscribedTenant({
      tag: "C2",
      status: "PAST_DUE",
      isActive: true,
      cycle: "MONTHLY",
      nextBillingDate: due,
      invoice: { type: "RENEWAL", dueDate: due }
    });
    await confirmPayment(invoice!.id, { now: NOW });
    expect((await subscriptionOf(tenant.id)).status).toBe("ACTIVE");
    expect((await getTenantEntitlements(tenant.id))?.status).toBe("ACTIVE");
  });
});

describe("payment adapters", () => {
  it("manual: checkout needs no redirect and no webhook is accepted", async () => {
    const adapter = getAdapter("manual")!;
    expect(adapter.id).toBe("manual");
    await expect(adapter.createCheckout({ id: "i", number: "INV-1", total: "100.00" })).resolves.toEqual({ kind: "MANUAL", paymentUrl: null, gatewayRef: null });
    await expect(adapter.getPayment("anything")).resolves.toBeNull();
    await expect(adapter.verifyWebhook({ headers: {}, rawBody: "" })).rejects.toBeInstanceOf(PaymentGatewayNotConnectedError);
  });

  it("gdc: every call says it is not connected", async () => {
    const adapter = getAdapter("gdc")!;
    await expect(adapter.createCheckout({ id: "i", number: "INV-1", total: "100.00" })).rejects.toBeInstanceOf(PaymentGatewayNotConnectedError);
    await expect(adapter.verifyWebhook({ headers: {}, rawBody: "{}" })).rejects.toThrow(/not connected/i);
    await expect(adapter.getPayment("ref")).rejects.toBeInstanceOf(PaymentGatewayNotConnectedError);
  });

  it("an unknown provider has no adapter", () => {
    expect(getAdapter("stripe")).toBeUndefined();
  });
});

describe("POST /api/webhooks/payments/:provider", () => {
  const post = (provider: string) => request(createApp()).post(`/api/webhooks/payments/${provider}`).send({ any: "thing" });

  it("answers 501 until a gateway is connected, without needing a login", async () => {
    for (const provider of ["gdc", "manual"]) {
      const res = await post(provider);
      expect(res.status).toBe(501);
      expect(res.body).toMatchObject({ success: false, error: { code: "NOT_IMPLEMENTED" } });
    }
  });

  it("answers 404 for a provider that does not exist", async () => {
    expect((await post("stripe")).status).toBe(404);
  });

  it("records nothing: an unverified webhook must not touch invoices", async () => {
    const { tenant } = await makeSubscribedTenant({ tag: "W1" });
    await post("gdc");
    expect((await invoicesOf(tenant.id))[0]?.status).toBe("OPEN");
    expect(await withoutTenantScope(async () => db.payment.count({ where: { tenantId: tenant.id } }))).toBe(0);
  });
});
