import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { confirmPayment } from "../src/lib/payments/confirm.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { cleanBilling, makeSubscribedTenant, seedCatalog } from "./billing-fixture.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";
import { cleanReferrals, commissionsOf, makePartner, makeReferral } from "./referral-fixture.js";

let token: string;
let adminId: string;

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
const P = "/api/platform";
const call = {
  get: (path: string) => auth(request(app()).get(`${P}${path}`)),
  post: (path: string, body: unknown = {}) => auth(request(app()).post(`${P}${path}`)).send(body as object),
  patch: (path: string, body: unknown = {}) => auth(request(app()).patch(`${P}${path}`)).send(body as object),
  put: (path: string, body: unknown = {}) => auth(request(app()).put(`${P}${path}`)).send(body as object)
};
const audit = (entity: string, action: string) => db.pricingAuditLog.findMany({ where: { entity, action } });
const referralOf = (tenantId: string) => withoutTenantScope(async () => db.tenantReferral.findUnique({ where: { tenantId } }));
const partnerRow = (id: string) => withoutTenantScope(async () => db.referralPartner.findUniqueOrThrow({ where: { id } }));

const newPartner = (over: Record<string, unknown> = {}) => ({
  name: "Siti Agen",
  email: "siti@agen.example",
  phone: "0813 1111 2222",
  city: "Malang",
  ktpNo: "3573010101900002",
  bankName: "Mandiri",
  bankAccountNo: "9876543210",
  bankAccountName: "Siti Agen",
  ...over
});

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await cleanReferrals();
  await cleanBilling();
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
  await cleanReferrals();
  await db.tenant.deleteMany({});
});
afterAll(async () => {
  await cleanReferrals();
  await cleanBilling();
  await db.$disconnect();
});

describe("access", () => {
  it("is closed to tenant roles on every new route", async () => {
    const tenant = await setupTenant({ slug: "biasa", registrationNo: "KOP-BIASA", adminEmail: "biasa@demo.test" });
    const t = (r: request.Test) => r.set("Authorization", `Bearer ${tenant.accessToken}`).send({});
    const base = request(app());
    const results = await Promise.all([
      t(base.post(`${P}/partners`)),
      t(base.patch(`${P}/partners/x`)),
      t(base.put(`${P}/tenants/x/referral`)),
      t(base.patch(`${P}/referrals/x`)),
      t(base.get(`${P}/referral-settings`)),
      t(base.put(`${P}/referral-settings`)),
      t(base.post(`${P}/commissions/x/void`))
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(7).fill(403));
  });
});

describe("POST /partners", () => {
  it("creates an ACTIVE ADMIN-source partner with a generated code and the program defaults", async () => {
    const res = await call.post("/partners", newPartner());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "ACTIVE", source: "ADMIN", commissionRate: "0.2000", commissionMonths: 12, phone: "081311112222" });
    expect(res.body.data.code).toMatch(/^NEX-[A-Z0-9]{6}$/);
    expect((await partnerRow(res.body.data.id)).createdById).toBe(adminId);
    expect(await audit("referral_partner", "CREATED")).toHaveLength(1);
  });

  it("accepts a vanity code, rate and months, and the code works at registration", async () => {
    const res = await call.post("/partners", newPartner({ code: "siti", commissionRate: "0.1", commissionMonths: 24 }));
    expect(res.body.data).toMatchObject({ code: "NEX-SITI", commissionRate: "0.1000", commissionMonths: 24 });
    const check = await request(app()).get("/api/onboarding/referral/NEX-SITI");
    expect(check.body.data.valid).toBe(true);
  });

  it("rejects a taken code, a duplicate email or phone, and out-of-range terms", async () => {
    await makePartner({ code: "NEX-TAKEN1", email: "ada@agen.example", phone: "081200000099" });
    expect((await call.post("/partners", newPartner({ code: "NEX-TAKEN1" }))).status).toBe(409);
    expect((await call.post("/partners", newPartner({ email: "ADA@agen.example" }))).status).toBe(409);
    expect((await call.post("/partners", newPartner({ phone: "081200000099" }))).status).toBe(409);
    expect((await call.post("/partners", newPartner({ commissionRate: "0.9" }))).status).toBe(422);
    expect((await call.post("/partners", newPartner({ commissionMonths: 61 }))).status).toBe(422);
    expect((await call.post("/partners", newPartner({ ktpNo: "1" }))).status).toBe(422);
  });
});

describe("PATCH /partners/:id", () => {
  it("edits contact and bank details without needing a reason", async () => {
    const p = await makePartner();
    const res = await call.patch(`/partners/${p.id}`, { bankName: "BNI", notes: "Dihubungi via WA", city: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ bankName: "BNI", notes: "Dihubungi via WA", city: null });
  });

  it("requires a reason to change rate, months or status, and audits the change", async () => {
    const p = await makePartner();
    expect((await call.patch(`/partners/${p.id}`, { commissionRate: "0.25" })).status).toBe(422);
    expect((await call.patch(`/partners/${p.id}`, { status: "SUSPENDED" })).status).toBe(422);
    const res = await call.patch(`/partners/${p.id}`, { commissionRate: "0.25", commissionMonths: 6, reason: "Negosiasi baru" });
    expect(res.body.data).toMatchObject({ commissionRate: "0.2500", commissionMonths: 6 });
    const [log] = await audit("referral_partner", "UPDATED");
    expect(log!.actorId).toBe(adminId);
    expect(log!.before).toMatchObject({ commissionRate: "0.2" });
    expect(log!.after).toMatchObject({ commissionRate: "0.25", reason: "Negosiasi baru" });
  });

  it("suspends and reactivates, and a suspended code stops accepting sign-ups", async () => {
    const p = await makePartner({ code: "NEX-SUSP01" });
    await call.patch(`/partners/${p.id}`, { status: "SUSPENDED", reason: "Pelanggaran" });
    expect((await request(app()).get("/api/onboarding/referral/NEX-SUSP01")).body.data.valid).toBe(false);
    await call.patch(`/partners/${p.id}`, { status: "ACTIVE", reason: "Selesai ditinjau" });
    expect((await request(app()).get("/api/onboarding/referral/NEX-SUSP01")).body.data.valid).toBe(true);
  });

  it("does not move a pending or rejected application through this route", async () => {
    const pending = await makePartner({ status: "PENDING", code: null });
    expect((await call.patch(`/partners/${pending.id}`, { status: "ACTIVE", reason: "Langsung aktif" })).status).toBe(409);
  });

  it("never changes the rate already snapshotted on referred koperasi", async () => {
    const { tenant } = await makeSubscribedTenant({ tag: "PA1" });
    const { partner } = await makeReferral(tenant.id, { rate: "0.2" });
    await call.patch(`/partners/${partner.id}`, { commissionRate: "0.4", reason: "Naik tarif" });
    expect((await referralOf(tenant.id))!.rate.toFixed(4)).toBe("0.2000");
  });

  it("returns 404 for an unknown partner", async () => {
    expect((await call.patch("/partners/nope", { notes: "x" })).status).toBe(404);
  });
});

describe("PUT /tenants/:id/referral", () => {
  it("attaches a partner to a tenant that has none, snapshotting the partner's terms", async () => {
    const { tenant } = await makeSubscribedTenant({ tag: "PA2" });
    const partner = await makePartner({ rate: "0.15", months: 6 });
    const res = await call.put(`/tenants/${tenant.id}/referral`, { partnerId: partner.id, reason: "Deal offline" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ codeUsed: partner.code, rate: "0.1500", months: 6, source: "ADMIN", flaggedSelfReferral: false });
    expect(await referralOf(tenant.id)).toMatchObject({ partnerId: partner.id, source: "ADMIN" });
    expect(await audit("tenant_referral", "ASSIGNED")).toHaveLength(1);
  });

  it("earns commission only on invoices paid after attaching", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "PA3" });
    await confirmPayment(invoice!.id, { now: new Date(Date.now() - 86_400_000), confirmedBy: "admin" });
    const partner = await makePartner();
    await call.put(`/tenants/${tenant.id}/referral`, { partnerId: partner.id, reason: "Deal offline" });
    expect(await commissionsOf(tenant.id)).toHaveLength(0);
  });

  it("reassigns to another partner, resetting terms but keeping commissions already earned", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "PA4" });
    const { partner: first } = await makeReferral(tenant.id, { rate: "0.2", attributedAt: new Date(Date.now() - 86_400_000) });
    await confirmPayment(invoice!.id, { now: new Date(), confirmedBy: "admin" });
    const second = await makePartner({ rate: "0.3", months: 3 });

    const res = await call.put(`/tenants/${tenant.id}/referral`, { partnerId: second.id, reason: "Salah atribusi" });
    expect(res.status).toBe(200);
    expect(await referralOf(tenant.id)).toMatchObject({ partnerId: second.id, months: 3 });
    const [earned] = await commissionsOf(tenant.id);
    expect(earned).toMatchObject({ partnerId: first.id, status: "ACCRUED" });
    const [log] = await audit("tenant_referral", "REASSIGNED");
    expect(log!.before).toMatchObject({ partnerId: first.id });
  });

  it("flags a self-referral when the partner's email is the Super Admin's", async () => {
    const { tenant, admin } = await makeSubscribedTenant({ tag: "PA5" });
    const partner = await makePartner({ email: admin.email! });
    const res = await call.put(`/tenants/${tenant.id}/referral`, { partnerId: partner.id, reason: "Cek" });
    expect(res.body.data.flaggedSelfReferral).toBe(true);
  });

  it("requires a reason, an ACTIVE partner, a real tenant, and a different partner when reassigning", async () => {
    const { tenant } = await makeSubscribedTenant({ tag: "PA6" });
    const partner = await makePartner();
    const suspended = await makePartner({ status: "SUSPENDED" });
    expect((await call.put(`/tenants/${tenant.id}/referral`, { partnerId: partner.id })).status).toBe(422);
    expect((await call.put(`/tenants/${tenant.id}/referral`, { partnerId: suspended.id, reason: "x y z" })).status).toBe(409);
    expect((await call.put(`/tenants/nope/referral`, { partnerId: partner.id, reason: "x y z" })).status).toBe(404);
    expect((await call.put(`/tenants/${tenant.id}/referral`, { partnerId: "nope", reason: "x y z" })).status).toBe(404);
    await call.put(`/tenants/${tenant.id}/referral`, { partnerId: partner.id, reason: "Pertama" });
    expect((await call.put(`/tenants/${tenant.id}/referral`, { partnerId: partner.id, reason: "Sama" })).status).toBe(409);
  });
});

describe("PATCH /referrals/:id", () => {
  it("changes rate and months going forward, recomputes the window, and audits", async () => {
    const { tenant } = await makeSubscribedTenant({ tag: "PA7" });
    const { referral } = await makeReferral(tenant.id, { rate: "0.2", months: 12, attributedAt: new Date("2026-01-01T00:00:00.000Z") });
    const res = await call.patch(`/referrals/${referral.id}`, { rate: "0.1", months: 6, reason: "Diskon khusus" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rate: "0.1000", months: 6, windowEndsAt: "2026-07-01T00:00:00.000Z" });
    const [log] = await audit("tenant_referral", "TERMS_CHANGED");
    expect(log!.before).toMatchObject({ rate: "0.2", months: 12 });
  });

  it("applies the new rate only to invoices paid after the change", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "PA8" });
    const { referral } = await makeReferral(tenant.id, { rate: "0.2", attributedAt: new Date(Date.now() - 86_400_000) });
    await confirmPayment(invoice!.id, { now: new Date(), confirmedBy: "admin" });
    await call.patch(`/referrals/${referral.id}`, { rate: "0", reason: "Jeda komisi" });
    const [row] = await commissionsOf(tenant.id);
    expect(row!.rate.toFixed(4)).toBe("0.2000");
  });

  it("validates range, needs a reason and at least one change", async () => {
    const { tenant } = await makeSubscribedTenant({ tag: "PA9" });
    const { referral } = await makeReferral(tenant.id);
    expect((await call.patch(`/referrals/${referral.id}`, { rate: "0.6", reason: "Terlalu besar" })).status).toBe(422);
    expect((await call.patch(`/referrals/${referral.id}`, { months: 0, reason: "Terlalu kecil" })).status).toBe(422);
    expect((await call.patch(`/referrals/${referral.id}`, { rate: "0.1" })).status).toBe(422);
    expect((await call.patch(`/referrals/${referral.id}`, { reason: "Tanpa perubahan" })).status).toBe(422);
    expect((await call.patch(`/referrals/nope`, { rate: "0.1", reason: "Tidak ada" })).status).toBe(404);
  });
});

describe("referral settings", () => {
  it("reads the program defaults", async () => {
    const res = await call.get("/referral-settings");
    expect(res.body.data).toEqual({ defaultRate: "0.2000", defaultMonths: 12 });
  });

  it("updates them with a reason, audits it, and prefills the next partner without touching existing ones", async () => {
    const existing = await makePartner({ rate: "0.2" });
    expect((await call.put("/referral-settings", { defaultRate: "0.25", defaultMonths: 9 })).status).toBe(422);
    const res = await call.put("/referral-settings", { defaultRate: "0.25", defaultMonths: 9, reason: "Kebijakan baru" });
    expect(res.body.data).toEqual({ defaultRate: "0.2500", defaultMonths: 9 });
    expect(await audit("referral_settings", "UPDATED")).toHaveLength(1);
    const created = await call.post("/partners", newPartner());
    expect(created.body.data).toMatchObject({ commissionRate: "0.2500", commissionMonths: 9 });
    expect((await partnerRow(existing.id)).commissionRate.toFixed(4)).toBe("0.2000");
  });

  it("rejects out-of-range defaults", async () => {
    expect((await call.put("/referral-settings", { defaultRate: "0.51", defaultMonths: 12, reason: "Uji batas" })).status).toBe(422);
    expect((await call.put("/referral-settings", { defaultRate: "0.2", defaultMonths: 61, reason: "Uji batas" })).status).toBe(422);
  });
});

describe("POST /commissions/:id/void", () => {
  const accrued = async (tag: string) => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag });
    await makeReferral(tenant.id, { attributedAt: new Date(Date.now() - 86_400_000) });
    await confirmPayment(invoice!.id, { now: new Date(), confirmedBy: "admin" });
    return (await commissionsOf(tenant.id))[0]!;
  };

  it("voids an ACCRUED commission with a reason and takes it out of the partner's totals", async () => {
    const row = await accrued("PV1");
    const res = await call.post(`/commissions/${row.id}/void`, { reason: "Faktur salah" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "VOID", voidReason: "Faktur salah" });
    expect(await audit("referral_commission", "VOIDED")).toHaveLength(1);
    const detail = await call.get(`/partners/${row.partnerId}`);
    expect(detail.body.data).toMatchObject({ commissionAccrued: "0.00", commissionOutstanding: "0.00", referredRevenue: "0.00" });
  });

  it("requires a reason and refuses a commission that is not ACCRUED", async () => {
    const row = await accrued("PV2");
    expect((await call.post(`/commissions/${row.id}/void`, {})).status).toBe(422);
    await call.post(`/commissions/${row.id}/void`, { reason: "Faktur salah" });
    expect((await call.post(`/commissions/${row.id}/void`, { reason: "Lagi" })).status).toBe(409);
    const paid = await accrued("PV3");
    await withoutTenantScope(async () => db.referralCommission.update({ where: { id: paid.id }, data: { status: "PAID" } }));
    expect((await call.post(`/commissions/${paid.id}/void`, { reason: "Sudah dibayar" })).status).toBe(409);
    expect((await call.post("/commissions/nope/void", { reason: "Tidak ada" })).status).toBe(404);
  });
});
