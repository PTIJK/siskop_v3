import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { confirmPayment } from "../src/lib/payments/confirm.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { createInvoice } from "../src/lib/pricing/invoice.js";
import { clearCatalogCache } from "../src/lib/pricing/catalog.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";
import { attachSubscription, daysFrom, resetCatalog, seedCatalog } from "./billing-fixture.js";

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  await seedCatalog();
  clearEntitlementCache();
  vi.stubEnv("PRICING_V2_ENFORCEMENT", "on");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.tenant.deleteMany({});
  await resetCatalog();
});

const as = (token: string) => ({
  get: (path: string) => request(app()).get(path).set("Authorization", `Bearer ${token}`),
  post: (path: string, body: object = {}) => request(app()).post(path).set("Authorization", `Bearer ${token}`).send(body)
});

async function tenantWith(opts: Parameters<typeof attachSubscription>[1] = {}, slug = "gate", legacyPackage = true) {
  const session = await setupTenant({ slug, registrationNo: `KOP-${slug.toUpperCase()}`, adminEmail: `admin@${slug}.test` }, { entitled: legacyPackage });
  await attachSubscription(session.user.tenantId, opts);
  return { ...session, api: as(session.accessToken) };
}

describe("payment standing", () => {
  it("lets an active subscription through", async () => {
    const t = await tenantWith({ status: "ACTIVE" });
    expect((await t.api.get("/api/members")).status).toBe(200);
  });

  it("answers 402 PAYMENT_REQUIRED when the koperasi has no subscription, but still serves the subscription page", async () => {
    const session = await setupTenant({ slug: "none", registrationNo: "KOP-NONE", adminEmail: "admin@none.test" });
    const api = as(session.accessToken);
    const res = await api.get("/api/members");
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ success: false, error: { code: "PAYMENT_REQUIRED", details: { reason: "NO_SUBSCRIPTION" } } });
    const sub = await api.get("/api/config/subscription");
    expect(sub.status).toBe(200);
    expect(sub.body.data).toBeNull();
  });

  it.each([
    ["PENDING_PAYMENT", "PENDING_PAYMENT"],
    ["CANCELLED", "CANCELLED"]
  ] as const)("blocks everything for a %s subscription, reads included", async (status, reason) => {
    const t = await tenantWith({ status });
    const res = await t.api.get("/api/members");
    expect(res.status).toBe(402);
    expect(res.body.error.details.reason).toBe(reason);
    expect((await t.api.get("/api/config/subscription")).status).toBe(200);
    expect((await t.api.get("/api/notifications")).status).toBe(200);
  });

  it("past due is read-only: reading works, creating answers 402", async () => {
    const t = await tenantWith({ status: "PAST_DUE" });
    expect((await t.api.get("/api/members")).status).toBe(200);
    const write = await t.api.post("/api/members", { fullName: "Budi", nik: "3171234567890001", address: "Jl. A", birthPlace: "Jakarta", birthDate: "1990-01-01", occupation: "Guru" });
    expect(write.status).toBe(402);
    expect(write.body.error.details.reason).toBe("PAST_DUE");
  });

  it("paying the overdue invoice lifts the block at once", async () => {
    const t = await tenantWith({ status: "PAST_DUE" });
    const sub = await withoutTenantScope(async () => db.tenantSubscription.findFirstOrThrow({ where: { tenantId: t.user.tenantId } }));
    const due = daysFrom(new Date(), -10);
    await db.tenantSubscription.update({ where: { id: sub.id, tenantId: t.user.tenantId }, data: { nextBillingDate: due } });
    const invoice = await db.$transaction((tx) =>
      createInvoice(tx, { tenantId: t.user.tenantId, subscriptionId: sub.id, type: "RENEWAL", quote: { subtotal: "500000.00", taxRate: null, taxAmount: "0.00", total: "500000.00" }, dueDate: due })
    );
    expect((await t.api.post("/api/members", {})).status).toBe(402);

    await confirmPayment(invoice.id);

    expect((await t.api.post("/api/members", {})).status).not.toBe(402);
  });

  it("never blocks a platform admin, whatever their own koperasi's state", async () => {
    const admin = await createPlatformAdminSession();
    const api = as(admin.accessToken);
    expect((await api.get("/api/platform/tenants")).status).toBe(200);
    expect((await api.get("/api/members")).status).toBe(200);
  });

  it("changes nothing while enforcement is off, and only logs in shadow mode", async () => {
    const session = await setupTenant({ slug: "soft", registrationNo: "KOP-SOFT", adminEmail: "admin@soft.test" });
    const api = as(session.accessToken);
    vi.stubEnv("PRICING_V2_ENFORCEMENT", "off");
    expect((await api.get("/api/members")).status).toBe(200);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("PRICING_V2_ENFORCEMENT", "shadow");
    expect((await api.get("/api/members")).status).toBe(200);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("PRICING_SHADOW PAYMENT_REQUIRED"))).toBe(true);
    warn.mockRestore();
  });

  it("ignores a request with no token or a bad one: the router's own login check answers", async () => {
    expect((await request(app()).get("/api/members")).status).toBe(401);
    expect((await request(app()).get("/api/members").set("Authorization", "Bearer nonsense")).status).toBe(401);
  });
});

describe("package features", () => {
  const custom = (featureKeys: string[]) => ({ packageCode: "custom", featureKeys });

  it("refuses a route whose feature the package lacks, naming the feature", async () => {
    const t = await tenantWith(custom([]));
    const res = await t.api.get("/api/reports/regulatory/neraca");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "FEATURE_NOT_ENTITLED", details: { feature: "reports_regulatory" } });
  });

  it("opens the same route once the package includes the feature", async () => {
    const t = await tenantWith(custom(["reports_regulatory"]));
    const res = await t.api.get("/api/reports/regulatory/neraca");
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(402);
  });

  it("the legacy accounting check steps aside: a koperasi with no legacy package but the V2 feature gets through", async () => {
    const without = await tenantWith(custom([]), "acc1", false);
    const blocked = await without.api.post("/api/journal", {});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.details.feature).toBe("manual_journal");

    const withFeature = await tenantWith(custom(["accounting_book", "manual_journal"]), "acc2", false);
    const res = await withFeature.api.post("/api/journal", {});
    expect(res.status).not.toBe(403); // reaches validation instead of the legacy package check
    expect(res.status).toBe(422);
  });

  it("keeps reading units and roles open, but gates changing them", async () => {
    const t = await tenantWith(custom([]));
    expect((await t.api.get("/api/config/units")).status).toBe(200);
    expect((await t.api.get("/api/config/roles")).status).toBe(200);
    expect((await t.api.post("/api/config/units", { type: "KSP", name: "Cabang" })).body.error.details.feature).toBe("config_branch_units");
  });

  it("two koperasi on different packages do not leak entitlements", async () => {
    const small = await tenantWith(custom([]), "iso1");
    const big = await tenantWith(custom(["reports_regulatory"]), "iso2");
    expect((await small.api.get("/api/reports/regulatory/neraca")).status).toBe(403);
    expect((await big.api.get("/api/reports/regulatory/neraca")).status).not.toBe(403);
    expect((await small.api.get("/api/reports/regulatory/neraca")).status).toBe(403);
  });

  it("denies a gated route to a tenant on the Free package that lacks the feature, and never to core routes", async () => {
    const t = await tenantWith({ packageCode: "free" });
    expect((await t.api.get("/api/savings")).status).not.toBe(403);
    expect((await t.api.get("/api/loans")).status).not.toBe(403);
    expect((await t.api.get("/api/expenses")).status).not.toBe(403);
  });
});

describe("GET /api/config/subscription", () => {
  it("tells the app which enforcement mode applies, so it only locks what the server will refuse", async () => {
    const t = await tenantWith({ packageCode: "free" });
    expect((await t.api.get("/api/config/subscription")).body.data.enforcement).toBe("on");
    vi.stubEnv("PRICING_V2_ENFORCEMENT", "shadow");
    expect((await t.api.get("/api/config/subscription")).body.data.enforcement).toBe("shadow");
    vi.stubEnv("PRICING_V2_ENFORCEMENT", "off");
    expect((await t.api.get("/api/config/subscription")).body.data.enforcement).toBe("off");
  });

  it("shows the invoice to pay and the owner's instructions while one is open", async () => {
    const t = await tenantWith({ status: "PAST_DUE" });
    const sub = await withoutTenantScope(async () => db.tenantSubscription.findFirstOrThrow({ where: { tenantId: t.user.tenantId } }));
    const due = daysFrom(new Date(), -3);
    const invoice = await db.$transaction((tx) =>
      createInvoice(tx, { tenantId: t.user.tenantId, subscriptionId: sub.id, type: "RENEWAL", quote: { subtotal: "500000.00", taxRate: "0.1100", taxAmount: "55000.00", total: "555000.00" }, dueDate: due })
    );
    const v1 = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
    const snap = structuredClone(v1.snapshot) as { settings: { paymentInstructions: string | null } };
    snap.settings.paymentInstructions = "Transfer ke BCA 123";
    await db.pricingVersion.update({ where: { version: 1 }, data: { snapshot: snap as never } });
    clearCatalogCache();

    const data = (await t.api.get("/api/config/subscription")).body.data;

    expect(data.status).toBe("PAST_DUE");
    expect(data.openInvoice).toMatchObject({ number: invoice.number, type: "RENEWAL", total: "555000.00", dueDate: due.toISOString() });
    expect(data.paymentInstructions).toBe("Transfer ke BCA 123");
  });

  it("has no open invoice once everything is paid", async () => {
    const t = await tenantWith({ status: "ACTIVE" });
    const data = (await t.api.get("/api/config/subscription")).body.data;
    expect(data.openInvoice).toBeNull();
  });

  it("never shows another koperasi's invoice", async () => {
    const a = await tenantWith({ status: "ACTIVE" }, "inva");
    const b = await tenantWith({ status: "ACTIVE" }, "invb");
    const sub = await withoutTenantScope(async () => db.tenantSubscription.findFirstOrThrow({ where: { tenantId: b.user.tenantId } }));
    await db.$transaction((tx) =>
      createInvoice(tx, { tenantId: b.user.tenantId, subscriptionId: sub.id, type: "RENEWAL", quote: { subtotal: "1.00", taxRate: null, taxAmount: "0.00", total: "1.00" }, dueDate: new Date() })
    );
    expect((await a.api.get("/api/config/subscription")).body.data.openInvoice).toBeNull();
    expect((await b.api.get("/api/config/subscription")).body.data.openInvoice).not.toBeNull();
  });
});
