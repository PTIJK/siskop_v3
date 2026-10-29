import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { runBillingJobs } from "../src/modules/billing/jobs.js";
import { daysFrom, invoicesOf, makeSubscribedTenant, paymentsOf, resetCatalog, seedCatalog, subscriptionOf } from "./billing-fixture.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";

let token: string;
let adminId: string;

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  await seedCatalog({ withVat: true });
  clearEntitlementCache();
  const session = await createPlatformAdminSession();
  token = session.accessToken;
  adminId = session.user.id;
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.tenant.deleteMany({});
  await resetCatalog();
});

const P = "/api/platform/invoices";
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
const get = (path = "") => auth(request(app()).get(`${P}${path}`));
const post = (path: string, body: unknown = {}) => auth(request(app()).post(`${P}${path}`)).send(body as object);

describe("access", () => {
  it("rejects anonymous callers", async () => {
    expect((await request(app()).get(P)).status).toBe(401);
    expect((await request(app()).post(`${P}/x/mark-paid`).send({})).status).toBe(401);
  });

  it("rejects a tenant admin who is not a platform admin", async () => {
    const tenant = await setupTenant({ slug: "biasa", registrationNo: "KOP-BIASA", adminEmail: "biasa@demo.test" });
    const res = await request(app()).get(P).set("Authorization", `Bearer ${tenant.accessToken}`);
    expect(res.status).toBe(403);
    const mark = await request(app()).post(`${P}/x/mark-paid`).set("Authorization", `Bearer ${tenant.accessToken}`).send({});
    expect(mark.status).toBe(403);
  });
});

describe("GET /invoices", () => {
  it("lists invoices newest first with the koperasi, package and money as strings", async () => {
    const a = await makeSubscribedTenant({ tag: "L1", packageCode: "small" });
    const b = await makeSubscribedTenant({ tag: "L2", packageCode: "medium", cycle: "YEARLY" });

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    const [first, second] = res.body.data.items;
    expect(first.id).toBe(b.invoice!.id);
    expect(first).toMatchObject({
      number: b.invoice!.number,
      type: "REGISTRATION",
      status: "OPEN",
      packageName: "Medium",
      billingCycle: "YEARLY",
      subtotal: "10000000.00",
      taxRate: "0.1100",
      taxAmount: "1100000.00",
      total: "11100000.00",
      tenant: { id: b.tenant.id, name: "Koperasi L2" },
      paidAt: null
    });
    expect(second.tenant.id).toBe(a.tenant.id);
  });

  it("filters by status, tenant and search text", async () => {
    const a = await makeSubscribedTenant({ tag: "F1" });
    const b = await makeSubscribedTenant({ tag: "F2", invoice: { status: "VOID" } });

    expect((await get("?status=VOID")).body.data.items.map((i: { id: string }) => i.id)).toEqual([b.invoice!.id]);
    expect((await get(`?tenantId=${a.tenant.id}`)).body.data.items.map((i: { id: string }) => i.id)).toEqual([a.invoice!.id]);
    expect((await get(`?q=${a.invoice!.number}`)).body.data.total).toBe(1);
    expect((await get("?q=koperasi%20f2")).body.data.items.map((i: { id: string }) => i.id)).toEqual([b.invoice!.id]);
    expect((await get("?q=nothing-matches")).body.data.total).toBe(0);
  });

  it("paginates", async () => {
    for (const tag of ["G1", "G2", "G3"]) await makeSubscribedTenant({ tag });
    const res = await get("?page=2&pageSize=2");
    expect(res.body.data).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(res.body.data.items).toHaveLength(1);
  });

  it("rejects an invalid status or page size", async () => {
    expect((await get("?status=BOGUS")).status).toBe(422);
    expect((await get("?pageSize=5000")).status).toBe(422);
  });

  it("shows the payment once an invoice is paid", async () => {
    const { invoice } = await makeSubscribedTenant({ tag: "F3" });
    await post(`/${invoice!.id}/mark-paid`, { method: "BANK_TRANSFER", reference: "TRF-9" });
    const row = (await get()).body.data.items[0];
    expect(row).toMatchObject({ status: "PAID", paymentMethod: "BANK_TRANSFER" });
    expect(row.paidAt).toEqual(expect.any(String));
  });
});

describe("GET /invoices/:id", () => {
  it("returns the invoice with its payments and the owner's payment instructions", async () => {
    const { invoice } = await makeSubscribedTenant({ tag: "D1" });
    await post(`/${invoice!.id}/mark-paid`, { reference: "TRF-1" });
    const res = await get(`/${invoice!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.payments).toEqual([expect.objectContaining({ method: "BANK_TRANSFER", reference: "TRF-1", amount: invoice!.total.toFixed(2) })]);
  });

  it("is 404 for an unknown invoice", async () => {
    expect((await get("/does-not-exist")).status).toBe(404);
  });
});

describe("POST /invoices/:id/mark-paid", () => {
  it("settles the invoice and activates the koperasi", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "M1" });

    const res = await post(`/${invoice!.id}/mark-paid`, { method: "BANK_TRANSFER", reference: "BCA-77" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ alreadyPaid: false, invoice: { status: "PAID" } });
    expect((await subscriptionOf(tenant.id)).status).toBe("ACTIVE");
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).isActive).toBe(true);
    const [payment] = await paymentsOf(tenant.id);
    expect(payment).toMatchObject({ method: "BANK_TRANSFER", gatewayTxnId: "BCA-77" });
  });

  it("defaults to a bank transfer and tolerates being clicked twice", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "M2" });
    const first = await post(`/${invoice!.id}/mark-paid`);
    const second = await post(`/${invoice!.id}/mark-paid`);
    expect(first.body.data.alreadyPaid).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyPaid).toBe(true);
    expect(await paymentsOf(tenant.id)).toHaveLength(1);
    expect((await paymentsOf(tenant.id))[0]?.method).toBe("BANK_TRANSFER");
  });

  it("uses the date the money arrived as the start of the subscription", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "M3", cycle: "MONTHLY" });
    const paidAt = daysFrom(new Date(), -3).toISOString();
    await post(`/${invoice!.id}/mark-paid`, { paidAt });
    expect((await subscriptionOf(tenant.id)).startsAt.toISOString()).toBe(paidAt);
  });

  it("records the platform admin who confirmed it", async () => {
    const { invoice } = await makeSubscribedTenant({ tag: "M4" });
    await post(`/${invoice!.id}/mark-paid`);
    const audit = await db.pricingAuditLog.findFirstOrThrow({ where: { entity: "invoice", entityId: invoice!.id, action: "PAID" } });
    expect(audit.actorId).toBe(adminId);
  });

  it("refuses a payment dated in the future, an unknown method, or extra fields", async () => {
    const { invoice } = await makeSubscribedTenant({ tag: "M5" });
    expect((await post(`/${invoice!.id}/mark-paid`, { paidAt: daysFrom(new Date(), 3).toISOString() })).status).toBe(422);
    expect((await post(`/${invoice!.id}/mark-paid`, { method: "BITCOIN" })).status).toBe(422);
    expect((await post(`/${invoice!.id}/mark-paid`, { amount: "1.00" })).status).toBe(422);
  });

  it("refuses a void invoice and an unknown one", async () => {
    const { invoice } = await makeSubscribedTenant({ tag: "M6", invoice: { status: "VOID" } });
    expect((await post(`/${invoice!.id}/mark-paid`)).status).toBe(409);
    expect((await post("/nope/mark-paid")).status).toBe(404);
  });

  it("lifts a past-due renewal", async () => {
    const due = daysFrom(new Date(), -10);
    const { tenant, invoice } = await makeSubscribedTenant({
      tag: "M7",
      status: "PAST_DUE",
      isActive: true,
      nextBillingDate: due,
      startsAt: daysFrom(due, -30),
      invoice: { type: "RENEWAL", dueDate: due }
    });
    await post(`/${invoice!.id}/mark-paid`);
    const sub = await subscriptionOf(tenant.id);
    expect(sub.status).toBe("ACTIVE");
    expect(sub.nextBillingDate!.getTime()).toBeGreaterThan(due.getTime());
  });
});

describe("POST /invoices/:id/void", () => {
  it("voids an open invoice and leaves the subscription alone", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "V1" });
    const res = await post(`/${invoice!.id}/void`);
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe("VOID");
    expect((await subscriptionOf(tenant.id)).status).toBe("PENDING_PAYMENT");
  });

  it("is a no-op when already void, and refuses a paid invoice", async () => {
    const voided = await makeSubscribedTenant({ tag: "V2", invoice: { status: "VOID" } });
    expect((await post(`/${voided.invoice!.id}/void`)).status).toBe(200);
    const paid = await makeSubscribedTenant({ tag: "V3", invoice: { status: "PAID" } });
    expect((await post(`/${paid.invoice!.id}/void`)).status).toBe(409);
  });

  it("lets the renewal job issue a fresh invoice at today's VAT", async () => {
    const due = daysFrom(new Date(), 10);
    const { tenant, invoice } = await makeSubscribedTenant({
      tag: "V4",
      status: "ACTIVE",
      nextBillingDate: due,
      startsAt: daysFrom(due, -30),
      invoice: { type: "RENEWAL", dueDate: due }
    });
    await post(`/${invoice!.id}/void`);
    await runBillingJobs(new Date());
    const open = (await invoicesOf(tenant.id)).filter((i) => i.status === "OPEN");
    expect(open).toHaveLength(1);
    expect(open[0]?.id).not.toBe(invoice!.id);
  });
});

describe("POST /invoices/:id/reissue", () => {
  it("replaces an unpaid registration invoice with a new one and a fresh deadline", async () => {
    const stale = daysFrom(new Date(), -2);
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "X1", invoice: { dueDate: stale } });

    const res = await post(`/${invoice!.id}/reissue`);

    expect(res.status).toBe(200);
    const created = res.body.data.invoice;
    expect(created.id).not.toBe(invoice!.id);
    expect(created).toMatchObject({ status: "OPEN", type: "REGISTRATION", total: invoice!.total.toFixed(2) });
    expect(created.number).not.toBe(invoice!.number);
    const days = (new Date(created.dueDate).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThanOrEqual(14);
    const all = await invoicesOf(tenant.id);
    expect(all.find((i) => i.id === invoice!.id)?.status).toBe("VOID");
  });

  it("keeps the koperasi out of the next purge", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "X2", invoice: { dueDate: daysFrom(new Date(), -2) } });
    await post(`/${invoice!.id}/reissue`);
    await runBillingJobs(new Date());
    expect(await db.tenant.findUnique({ where: { id: tenant.id } })).not.toBeNull();
  });

  it("can reissue an expired invoice", async () => {
    const { invoice } = await makeSubscribedTenant({ tag: "X3", invoice: { status: "EXPIRED" } });
    expect((await post(`/${invoice!.id}/reissue`)).status).toBe(200);
  });

  it("refuses a paid invoice and a renewal invoice", async () => {
    const paid = await makeSubscribedTenant({ tag: "X4", invoice: { status: "PAID" } });
    expect((await post(`/${paid.invoice!.id}/reissue`)).status).toBe(409);
    const renewal = await makeSubscribedTenant({ tag: "X5", status: "ACTIVE", invoice: { type: "RENEWAL" } });
    expect((await post(`/${renewal.invoice!.id}/reissue`)).status).toBe(409);
  });

  it("does not leave two open invoices when called twice", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "X6" });
    const first = await post(`/${invoice!.id}/reissue`);
    const again = await post(`/${invoice!.id}/reissue`); // the old one is void now
    expect(first.status).toBe(200);
    expect(again.status).toBe(409);
    expect((await invoicesOf(tenant.id)).filter((i) => i.status === "OPEN")).toHaveLength(1);
    expect(await withoutTenantScope(async () => db.payment.count({ where: { tenantId: tenant.id } }))).toBe(0);
  });
});
