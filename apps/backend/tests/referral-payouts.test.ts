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
  post: (path: string, body: unknown = {}) => auth(request(app()).post(`${P}${path}`)).send(body as object)
};
const audit = (action: string) => db.pricingAuditLog.findMany({ where: { entity: "referral_payout", action } });
const commissionRows = (partnerId: string) =>
  withoutTenantScope(async () => db.referralCommission.findMany({ where: { partnerId }, orderBy: { accruedAt: "asc" } }));

let tagSeq = 0;
/** One ACCRUED commission for `partnerId`, accrued at `paidAt`. */
async function accrue(partnerId: string, paidAt: string, tenantName?: string) {
  const tag = `PO${++tagSeq}`;
  const { tenant, invoice } = await makeSubscribedTenant({ tag });
  if (tenantName) await db.tenant.update({ where: { id: tenant.id }, data: { name: tenantName } });
  await makeReferral(tenant.id, { partnerId, rate: "0.2", attributedAt: new Date("2026-01-01T00:00:00.000Z") });
  await confirmPayment(invoice!.id, { now: new Date(paidAt), confirmedBy: "admin" });
  return (await commissionsOf(tenant.id))[0]!;
}

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
  it("is closed to tenant roles", async () => {
    const tenant = await setupTenant({ slug: "biasa", registrationNo: "KOP-BIASA", adminEmail: "biasa@demo.test" });
    const t = (r: request.Test) => r.set("Authorization", `Bearer ${tenant.accessToken}`).send({});
    const base = request(app());
    const results = await Promise.all([
      t(base.get(`${P}/payouts`)),
      t(base.post(`${P}/payouts`)),
      t(base.post(`${P}/payouts/x/mark-paid`)),
      t(base.post(`${P}/payouts/x/cancel`)),
      t(base.get(`${P}/partners/x/statement.csv`))
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(403));
  });
});

describe("POST /payouts", () => {
  it("drafts a payout from ACCRUED commissions up to the cutoff day, inclusive, and links them", async () => {
    const partner = await makePartner();
    const a = await accrue(partner.id, "2026-03-10T08:00:00.000Z");
    const b = await accrue(partner.id, "2026-03-31T16:00:00.000Z"); // 23:00 WIB on the cutoff day
    const late = await accrue(partner.id, "2026-03-31T18:00:00.000Z"); // 01:00 WIB next day

    const res = await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" });
    expect(res.status).toBe(201);
    const expected = a.amount.plus(b.amount);
    expect(res.body.data).toMatchObject({ status: "DRAFT", commissionCount: 2, grossAmount: expected.toFixed(2), taxWithheld: "0.00", netAmount: expected.toFixed(2) });
    expect(res.body.data.number).toMatch(/^PO-\d{6}-0001$/);
    expect(res.body.data.partner).toMatchObject({ id: partner.id, code: partner.code });

    const rows = await commissionRows(partner.id);
    expect(rows.filter((r) => r.payoutId === res.body.data.id).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(rows.find((r) => r.id === late.id)!.payoutId).toBeNull();
    expect((await audit("CREATED")).length).toBe(1);
  });

  it("skips voided, paid and already-drafted commissions, and numbers payouts in sequence", async () => {
    const partner = await makePartner();
    const voided = await accrue(partner.id, "2026-03-01T08:00:00.000Z");
    await accrue(partner.id, "2026-03-02T08:00:00.000Z");
    await call.post(`/commissions/${voided.id}/void`, { reason: "Faktur salah" });

    const first = await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" });
    expect(first.body.data.commissionCount).toBe(1);
    await accrue(partner.id, "2026-03-03T08:00:00.000Z");
    const second = await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" });
    expect(second.body.data.commissionCount).toBe(1);
    expect(second.body.data.number.endsWith("0002")).toBe(true);
  });

  it("rejects an empty batch, an unknown partner, and a bad date", async () => {
    const partner = await makePartner();
    expect((await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" })).status).toBe(422);
    expect((await call.post("/payouts", { partnerId: "nope", periodEnd: "2026-03-31" })).status).toBe(404);
    expect((await call.post("/payouts", { partnerId: partner.id, periodEnd: "31-03-2026" })).status).toBe(422);
    expect((await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-02-30" })).status).toBe(422);
  });

  it("does not pay one partner's commissions into another's payout", async () => {
    const a = await makePartner();
    const b = await makePartner();
    await accrue(a.id, "2026-03-01T08:00:00.000Z");
    expect((await call.post("/payouts", { partnerId: b.id, periodEnd: "2026-03-31" })).status).toBe(422);
  });
});

describe("GET /payouts", () => {
  it("lists newest first and filters by status and partner", async () => {
    const a = await makePartner();
    const b = await makePartner();
    await accrue(a.id, "2026-03-01T08:00:00.000Z");
    await accrue(b.id, "2026-03-01T08:00:00.000Z");
    const first = await call.post("/payouts", { partnerId: a.id, periodEnd: "2026-03-31" });
    await call.post("/payouts", { partnerId: b.id, periodEnd: "2026-03-31" });
    await call.post(`/payouts/${first.body.data.id}/cancel`);

    expect((await call.get("/payouts")).body.data).toHaveLength(2);
    expect((await call.get("/payouts?status=CANCELLED")).body.data.map((p: { id: string }) => p.id)).toEqual([first.body.data.id]);
    expect((await call.get(`/payouts?partnerId=${b.id}`)).body.data).toHaveLength(1);
    expect((await call.get("/payouts?status=NOPE")).status).toBe(422);
  });
});

describe("POST /payouts/:id/mark-paid", () => {
  const draft = async () => {
    const partner = await makePartner();
    await accrue(partner.id, "2026-03-01T08:00:00.000Z");
    await accrue(partner.id, "2026-03-02T08:00:00.000Z");
    const res = await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" });
    return { partner, payout: res.body.data as { id: string; grossAmount: string } };
  };

  it("records the transfer, nets the tax, marks commissions PAID and zeroes the outstanding balance", async () => {
    const { partner, payout } = await draft();
    const gross = Number(payout.grossAmount);
    const res = await call.post(`/payouts/${payout.id}/mark-paid`, { transferRef: "TRF-123", paidAt: "2026-04-05T03:00:00.000Z", taxWithheld: "1000" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "PAID", transferRef: "TRF-123", taxWithheld: "1000.00", paidAt: "2026-04-05T03:00:00.000Z" });
    expect(Number(res.body.data.netAmount)).toBeCloseTo(gross - 1000, 2);
    expect((await commissionRows(partner.id)).map((r) => r.status)).toEqual(["PAID", "PAID"]);
    expect((await call.get(`/partners/${partner.id}`)).body.data).toMatchObject({ commissionOutstanding: "0.00", commissionPaid: payout.grossAmount });
    const [log] = await audit("PAID");
    expect(log!.actorId).toBe(adminId);
    expect((await withoutTenantScope(async () => db.referralPayout.findUniqueOrThrow({ where: { id: payout.id } }))).paidById).toBe(adminId);
  });

  it("defaults the paid date to now and the tax to zero", async () => {
    const { payout } = await draft();
    const res = await call.post(`/payouts/${payout.id}/mark-paid`, { transferRef: "TRF-1" });
    expect(res.body.data.taxWithheld).toBe("0.00");
    expect(res.body.data.netAmount).toBe(payout.grossAmount);
    expect(Date.now() - new Date(res.body.data.paidAt).getTime()).toBeLessThan(60_000);
  });

  it("requires a transfer reference, keeps tax within the gross, and refuses a second payment", async () => {
    const { payout } = await draft();
    expect((await call.post(`/payouts/${payout.id}/mark-paid`, {})).status).toBe(422);
    expect((await call.post(`/payouts/${payout.id}/mark-paid`, { transferRef: " " })).status).toBe(422);
    expect((await call.post(`/payouts/${payout.id}/mark-paid`, { transferRef: "T", taxWithheld: "-1" })).status).toBe(422);
    expect((await call.post(`/payouts/${payout.id}/mark-paid`, { transferRef: "T", taxWithheld: String(Number(payout.grossAmount) + 1) })).status).toBe(422);
    expect((await call.post(`/payouts/${payout.id}/mark-paid`, { transferRef: "T" })).status).toBe(200);
    expect((await call.post(`/payouts/${payout.id}/mark-paid`, { transferRef: "T2" })).status).toBe(409);
    expect((await call.post("/payouts/nope/mark-paid", { transferRef: "T" })).status).toBe(404);
  });
});

describe("POST /payouts/:id/cancel", () => {
  it("releases the commissions back to ACCRUED so a new payout can take them", async () => {
    const partner = await makePartner();
    await accrue(partner.id, "2026-03-01T08:00:00.000Z");
    const draft = (await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" })).body.data;
    const res = await call.post(`/payouts/${draft.id}/cancel`, { reason: "Salah periode" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect((await commissionRows(partner.id))[0]).toMatchObject({ status: "ACCRUED", payoutId: null });
    expect((await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" })).status).toBe(201);
    expect(await audit("CANCELLED")).toHaveLength(1);
  });

  it("refuses to cancel a paid or already cancelled payout", async () => {
    const partner = await makePartner();
    await accrue(partner.id, "2026-03-01T08:00:00.000Z");
    const draft = (await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" })).body.data;
    await call.post(`/payouts/${draft.id}/mark-paid`, { transferRef: "T" });
    expect((await call.post(`/payouts/${draft.id}/cancel`)).status).toBe(409);
    expect((await call.post("/payouts/nope/cancel")).status).toBe(404);
  });
});

describe("voiding a commission that is in a draft payout", () => {
  it("is refused until the payout is cancelled", async () => {
    const partner = await makePartner();
    const row = await accrue(partner.id, "2026-03-01T08:00:00.000Z");
    const draft = (await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" })).body.data;
    expect((await call.post(`/commissions/${row.id}/void`, { reason: "Faktur salah" })).status).toBe(409);
    await call.post(`/payouts/${draft.id}/cancel`);
    expect((await call.post(`/commissions/${row.id}/void`, { reason: "Faktur salah" })).status).toBe(200);
  });
});

describe("GET /partners/:id/statement.csv", () => {
  it("downloads the period's commissions as an Excel-safe CSV with payout numbers", async () => {
    const partner = await makePartner();
    await accrue(partner.id, "2026-03-05T08:00:00.000Z", "=HYPERLINK(\"x\")");
    await accrue(partner.id, "2026-04-05T08:00:00.000Z", "Koperasi, April");
    const payout = (await call.post("/payouts", { partnerId: partner.id, periodEnd: "2026-03-31" })).body.data;

    const res = await call.get(`/partners/${partner.id}/statement.csv?from=2026-03-01&to=2026-03-31`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="statement-NEX-.*\.csv"/);
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Tanggal,Koperasi,Faktur,Dasar,Tarif,Komisi,Status,Pembayaran");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain(payout.number);
    expect(lines[1]).toContain("20%");
  });

  it("covers everything without a period, quoting commas", async () => {
    const partner = await makePartner();
    await accrue(partner.id, "2026-03-05T08:00:00.000Z", "Koperasi, Satu");
    await accrue(partner.id, "2026-04-05T08:00:00.000Z");
    const res = await call.get(`/partners/${partner.id}/statement.csv`);
    expect(res.text.slice(1).trim().split("\r\n")).toHaveLength(3);
    expect(res.text).toContain('"Koperasi, Satu"');
  });

  it("validates the period and the partner", async () => {
    const partner = await makePartner();
    expect((await call.get(`/partners/${partner.id}/statement.csv?from=bad`)).status).toBe(422);
    expect((await call.get("/partners/nope/statement.csv")).status).toBe(404);
  });
});
