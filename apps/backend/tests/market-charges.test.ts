import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function createMarketAs(accessToken: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/market/markets")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Pasar Induk", ...overrides });
  return res;
}

async function createStallAs(accessToken: string, marketId: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/market/stalls")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ marketId, code: "A-01", kind: "KIOS", ...overrides });
  return res;
}

/** No generator endpoint exists yet — a Charge fixture is inserted directly, same as any other test that needs a pre-existing row. */
async function insertCharge(params: {
  tenantId: string;
  unitId: string;
  memberId: string;
  stallId: string;
  kind?: "SEWA" | "RETRIBUSI";
  amount?: number;
  paidAmount?: number;
  status?: "UNPAID" | "PARTIAL" | "PAID";
  periodStart?: string;
}) {
  return db.charge.create({
    data: {
      tenantId: params.tenantId,
      unitId: params.unitId,
      memberId: params.memberId,
      stallId: params.stallId,
      kind: params.kind ?? "RETRIBUSI",
      sourceId: `test-source-${Math.random().toString(36).slice(2)}`,
      periodStart: new Date(params.periodStart ?? "2026-09-26"),
      dueDate: new Date(params.periodStart ?? "2026-09-26"),
      amount: params.amount ?? 5000,
      paidAmount: params.paidAmount ?? 0,
      status: params.status ?? "UNPAID"
    }
  });
}

async function generateCoa(accessToken: string) {
  await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${accessToken}`);
}

describe("GET /api/market/charges", () => {
  it("filters by marketId, block, status, and memberId", async () => {
    const admin = await setupTenant();
    const marketA = await createMarketAs(admin.accessToken, { name: "Pasar A" });
    const marketB = await createMarketAs(admin.accessToken, { name: "Pasar B" });
    const stallA1 = await createStallAs(admin.accessToken, marketA.body.data.id, { code: "A-01", block: "A" });
    const stallA2 = await createStallAs(admin.accessToken, marketA.body.data.id, { code: "B-01", block: "B" });
    const stallB1 = await createStallAs(admin.accessToken, marketB.body.data.id, { code: "A-01", block: "A" });
    const memberX = await createMemberAs(admin.accessToken, { nik: "3171234567890001" });
    const memberY = await createMemberAs(admin.accessToken, { nik: "3171234567890002" });

    await insertCharge({ tenantId: admin.user.tenantId, unitId: marketA.body.data.unitId, memberId: memberX.id, stallId: stallA1.body.data.id, status: "UNPAID" });
    await insertCharge({ tenantId: admin.user.tenantId, unitId: marketA.body.data.unitId, memberId: memberY.id, stallId: stallA2.body.data.id, status: "PAID" });
    await insertCharge({ tenantId: admin.user.tenantId, unitId: marketB.body.data.unitId, memberId: memberX.id, stallId: stallB1.body.data.id, status: "UNPAID" });

    const byMarket = await request(app())
      .get(`/api/market/charges?marketId=${marketA.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byMarket.body.data).toHaveLength(2);

    const byBlock = await request(app())
      .get(`/api/market/charges?marketId=${marketA.body.data.id}&block=A`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byBlock.body.data).toHaveLength(1);
    expect(byBlock.body.data[0].stallCode).toBe("A-01");
    expect(byBlock.body.data[0].marketName).toBe("Pasar A");

    const byStatus = await request(app())
      .get(`/api/market/charges?status=PAID`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byStatus.body.data).toHaveLength(1);

    const byMember = await request(app())
      .get(`/api/market/charges?memberId=${memberX.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byMember.body.data).toHaveLength(2);
  });

  it("only returns the caller's own tenant's charges", async () => {
    const tenantA = await setupTenant({ slug: "pasar-cha", registrationNo: "KOP-PASAR-CHA" });
    const tenantB = await setupTenant({ slug: "pasar-chb", registrationNo: "KOP-PASAR-CHB" });
    const marketA = await createMarketAs(tenantA.accessToken);
    const stallA = await createStallAs(tenantA.accessToken, marketA.body.data.id);
    const memberA = await createMemberAs(tenantA.accessToken);
    await insertCharge({ tenantId: tenantA.user.tenantId, unitId: marketA.body.data.unitId, memberId: memberA.id, stallId: stallA.body.data.id });

    const res = await request(app()).get("/api/market/charges").set("Authorization", `Bearer ${tenantB.accessToken}`);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("POST /api/market/charges/:id/pay", () => {
  it("pays a charge in full, posting a balanced journal entry", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const member = await createMemberAs(admin.accessToken);
    await generateCoa(admin.accessToken);
    const charge = await insertCharge({
      tenantId: admin.user.tenantId,
      unitId: market.body.data.unitId,
      memberId: member.id,
      stallId: stall.body.data.id,
      amount: 5000
    });

    const res = await request(app())
      .post(`/api/market/charges/${charge.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PAID");
    expect(res.body.data.paidAmount).toBe("5000");

    const entry = await db.journalEntry.findFirst({
      where: { tenantId: admin.user.tenantId, sourceType: "CHARGE_PAYMENT" },
      include: { lines: true }
    });
    expect(entry?.status).toBe("POSTED");
    const totalDebit = entry!.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = entry!.lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("allows a partial payment, leaving the charge PARTIAL", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const member = await createMemberAs(admin.accessToken);
    await generateCoa(admin.accessToken);
    const charge = await insertCharge({
      tenantId: admin.user.tenantId,
      unitId: market.body.data.unitId,
      memberId: member.id,
      stallId: stall.body.data.id,
      amount: 5000
    });

    const res = await request(app())
      .post(`/api/market/charges/${charge.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 2000 });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PARTIAL");
    expect(res.body.data.paidAmount).toBe("2000");
  });

  it("rejects a payment exceeding the remaining amount", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const member = await createMemberAs(admin.accessToken);
    await generateCoa(admin.accessToken);
    const charge = await insertCharge({
      tenantId: admin.user.tenantId,
      unitId: market.body.data.unitId,
      memberId: member.id,
      stallId: stall.body.data.id,
      amount: 5000
    });

    const res = await request(app())
      .post(`/api/market/charges/${charge.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 6000 });

    expect(res.status).toBe(422);
  });

  it("404s a charge belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "pasar-chc", registrationNo: "KOP-PASAR-CHC" });
    const tenantB = await setupTenant({ slug: "pasar-chd", registrationNo: "KOP-PASAR-CHD" });
    const market = await createMarketAs(tenantA.accessToken);
    const stall = await createStallAs(tenantA.accessToken, market.body.data.id);
    const member = await createMemberAs(tenantA.accessToken);
    const charge = await insertCharge({
      tenantId: tenantA.user.tenantId,
      unitId: market.body.data.unitId,
      memberId: member.id,
      stallId: stall.body.data.id
    });

    const res = await request(app())
      .post(`/api/market/charges/${charge.id}/pay`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ amount: 1000 });

    expect(res.status).toBe(404);
  });

  it("a Viewer gets 403 trying to pay a charge", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const member = await createMemberAs(admin.accessToken);
    await generateCoa(admin.accessToken);
    const charge = await insertCharge({
      tenantId: admin.user.tenantId,
      unitId: market.body.data.unitId,
      memberId: member.id,
      stallId: stall.body.data.id
    });
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer-charges@demo.com");

    const res = await request(app())
      .post(`/api/market/charges/${charge.id}/pay`)
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ amount: 1000 });

    expect(res.status).toBe(403);
  });
});
