import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { verifyFirebaseIdentity } from "../src/modules/onboarding/firebase.js";
import { cleanBilling, seedCatalog } from "./billing-fixture.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";
import { cleanReferrals } from "./referral-fixture.js";

vi.mock("../src/modules/onboarding/firebase.js", () => ({ verifyFirebaseIdentity: vi.fn(), assertFirebaseSession: vi.fn() }));

// Milestone 7 acceptance: the plan's manual E2E, driven over HTTP against the real app and database.
// Only Firebase is stubbed, because there is no identity provider in the test environment.

let token: string;
const asAdmin = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
const admin = {
  get: (path: string) => asAdmin(request(app()).get(`/api/platform${path}`)),
  post: (path: string, body: unknown = {}) => asAdmin(request(app()).post(`/api/platform${path}`)).send(body as object)
};

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await cleanReferrals();
  await cleanBilling();
  await db.tenant.deleteMany({});
  await seedCatalog({ withVat: true });
  clearEntitlementCache();
  token = (await createPlatformAdminSession()).accessToken;
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
  vi.mocked(verifyFirebaseIdentity)
    .mockReset()
    .mockResolvedValue({ uid: "e2e-uid", email: "ketua@koperasi-e2e.example", provider: "password", authTime: Math.floor(Date.now() / 1000), emailVerified: true });
});
afterAll(async () => {
  await cleanReferrals();
  await cleanBilling();
  await db.tenant.deleteMany({});
  await db.$disconnect();
});

const application = {
  name: "Budi Santoso",
  email: "budi@mitra-e2e.example",
  phone: "081234567890",
  ktpNo: "3578010101900001",
  bankName: "BCA",
  bankAccountNo: "1234567890",
  bankAccountName: "Budi Santoso",
  termsVersion: "2026-11",
  acceptTerms: true
};
const registration = (referralCode?: string) => ({
  subscription: { packageCode: "small", billingCycle: "MONTHLY" },
  tenantName: "Koperasi E2E",
  registrationNo: "E2E-1",
  address: "Jl. Uji 1",
  type: "KONVENSIONAL",
  adminName: "Ketua",
  idToken: "verified",
  firstUnit: { type: "KSP", name: "Simpan pinjam" },
  ...(referralCode ? { referralCode } : {})
});

describe("referral program, end to end", () => {
  it("runs apply, approve, referred sign-up, paid invoice, commission, payout and reporting", async () => {
    // 1. A visitor applies; the application waits for review and has no code.
    expect((await request(app()).post("/api/partners/apply").send(application)).body.data).toEqual({ received: true });
    const pending = (await admin.get("/partners?status=PENDING")).body.data;
    expect(pending).toHaveLength(1);
    expect(pending[0].code).toBeNull();

    // 2. Admin approves: exactly one code, usable on the public check.
    const approved = (await admin.post(`/partners/${pending[0].id}/approve`)).body.data;
    expect(approved).toMatchObject({ status: "ACTIVE", commissionRate: "0.2000", commissionMonths: 12 });
    const code = approved.code as string;
    expect((await request(app()).get(`/api/onboarding/referral/${code}`)).body.data).toEqual({ valid: true, partnerName: "Budi Santoso" });

    // 3. A koperasi registers a paid plan with the code (share-link style, lowercase).
    const registered = await request(app()).post("/api/onboarding/register").send(registration(code.toLowerCase()));
    expect(registered.status).toBe(201);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: registered.body.data.slug } });
    const invoice = await withoutTenantScope(async () => db.invoice.findFirstOrThrow({ where: { tenantId: tenant.id } }));
    expect(invoice.status).toBe("OPEN");
    expect(invoice.subtotal.eq(invoice.total)).toBe(false);

    // Nothing is owed until the invoice is paid.
    expect((await admin.get(`/partners/${approved.id}`)).body.data).toMatchObject({ referredTenants: 1, commissionAccrued: "0.00" });

    // 4. Admin marks it paid; the partner earns 20% of the subtotal, and paying twice adds nothing.
    expect((await admin.post(`/invoices/${invoice.id}/mark-paid`, { method: "BANK_TRANSFER", reference: "TRF-E2E" })).status).toBe(200);
    await admin.post(`/invoices/${invoice.id}/mark-paid`, { method: "BANK_TRANSFER", reference: "TRF-E2E" });
    const afterPay = (await admin.get(`/partners/${approved.id}`)).body.data;
    expect(afterPay.commissions).toHaveLength(1);
    const expected = invoice.subtotal.mul("0.2").toFixed(2);
    expect(afterPay.commissions[0]).toMatchObject({ baseAmount: invoice.subtotal.toFixed(2), rate: "0.2000", amount: expected, status: "ACCRUED" });
    expect(afterPay).toMatchObject({ commissionOutstanding: expected, referredRevenue: invoice.subtotal.toFixed(2) });

    // 5. Dashboard reflects it.
    const dashboard = (await admin.get("/dashboard")).body.data.referrals;
    expect(dashboard).toMatchObject({ activePartners: 1, referredTenants: 1, commissionOutstanding: expected, referredRevenueTotal: invoice.subtotal.toFixed(2) });

    // 6. Payout: draft, then paid; outstanding falls to zero and the statement lists the payout number.
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const payout = (await admin.post("/payouts", { partnerId: approved.id, periodEnd: today })).body.data;
    expect(payout).toMatchObject({ status: "DRAFT", grossAmount: expected, commissionCount: 1 });
    const paid = (await admin.post(`/payouts/${payout.id}/mark-paid`, { transferRef: "BCA-001", taxWithheld: "0" })).body.data;
    expect(paid).toMatchObject({ status: "PAID", netAmount: expected });
    expect((await admin.get(`/partners/${approved.id}`)).body.data).toMatchObject({ commissionOutstanding: "0.00", commissionPaid: expected });

    const statement = await admin.get(`/partners/${approved.id}/statement.csv`);
    expect(statement.text).toContain(payout.number);
    expect(statement.text).toContain("Koperasi E2E");
    expect((await admin.get("/dashboard")).body.data.referrals.commissionOutstanding).toBe("0.00");
  });

  it("refuses a registration with a pending, rejected or unknown code and creates nothing", async () => {
    await request(app()).post("/api/partners/apply").send(application);
    const [pending] = (await admin.get("/partners?status=PENDING")).body.data;
    expect((await request(app()).post("/api/onboarding/register").send(registration("NEX-NOCODE"))).status).toBe(422);
    await admin.post(`/partners/${pending.id}/reject`, { reason: "Data tidak lengkap" });
    expect((await request(app()).post("/api/onboarding/register").send(registration("NEX-NOCODE"))).status).toBe(422);
    expect(await db.tenant.count({ where: { registrationNo: "E2E-1" } })).toBe(0);
  });

  it("registers normally without a code, and earns nobody a commission", async () => {
    const res = await request(app()).post("/api/onboarding/register").send(registration());
    expect(res.status).toBe(201);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: res.body.data.slug } });
    const invoice = await withoutTenantScope(async () => db.invoice.findFirstOrThrow({ where: { tenantId: tenant.id } }));
    await admin.post(`/invoices/${invoice.id}/mark-paid`, { method: "BANK_TRANSFER", reference: "TRF-NOREF" });
    expect(await withoutTenantScope(async () => db.referralCommission.count())).toBe(0);
  });
});

describe("access control on every referral route", () => {
  const routes: [method: "get" | "post" | "put" | "patch", path: string][] = [
    ["get", "/partners"],
    ["post", "/partners"],
    ["get", "/partners/x"],
    ["patch", "/partners/x"],
    ["get", "/partners/x/statement.csv"],
    ["post", "/partners/x/approve"],
    ["post", "/partners/x/reject"],
    ["put", "/tenants/x/referral"],
    ["patch", "/referrals/x"],
    ["get", "/referral-settings"],
    ["put", "/referral-settings"],
    ["post", "/commissions/x/void"],
    ["get", "/payouts"],
    ["post", "/payouts"],
    ["post", "/payouts/x/mark-paid"],
    ["post", "/payouts/x/cancel"]
  ];

  it("returns 401 to anonymous callers and 403 to a tenant admin", async () => {
    const tenant = await setupTenant({ slug: "biasa", registrationNo: "KOP-BIASA", adminEmail: "biasa@demo.test" });
    for (const [method, path] of routes) {
      const anonymous = await request(app())[method](`/api/platform${path}`).send({});
      const tenantUser = await request(app())[method](`/api/platform${path}`).set("Authorization", `Bearer ${tenant.accessToken}`).send({});
      expect([method, path, anonymous.status, tenantUser.status]).toEqual([method, path, 401, 403]);
    }
  });

  it("keeps the only public referral endpoints free of partner details", async () => {
    await request(app()).post("/api/partners/apply").send(application);
    const [pending] = (await admin.get("/partners?status=PENDING")).body.data;
    const code = (await admin.post(`/partners/${pending.id}/approve`)).body.data.code as string;
    const check = await request(app()).get(`/api/onboarding/referral/${code}`);
    expect(Object.keys(check.body.data).sort()).toEqual(["partnerName", "valid"]);
    expect(JSON.stringify(check.body)).not.toMatch(/budi@|3578|BCA|1234567890|commission/i);
    const apply = await request(app()).post("/api/partners/apply").send(application);
    expect(apply.body.data).toEqual({ received: true });
  });
});
