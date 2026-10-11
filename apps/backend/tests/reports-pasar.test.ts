import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createMemberWithPokokSaving, createStaffSession, setupTenant } from "./helpers.js";
import { businessDate } from "../src/lib/operating-calendar.js";
import { getRekapHarianKolektor, getTunggakanAngsuran, getTunggakanSewaRetribusi } from "../src/modules/reports/pasar-service.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

async function setupTenantWithCollector() {
  const admin = await setupTenant();
  await request(app()).post("/api/config/accounts/generate-standard").set(bearer(admin.accessToken));
  const collector = await createStaffSession(admin.user.tenantId, "demo", "Kolektor", "kolektor@demo.test");
  return { admin, collector };
}

describe("getRekapHarianKolektor", () => {
  it("reports TIDAK_ADA_SETORAN for a kolektor with no batch today", async () => {
    const { admin, collector } = await setupTenantWithCollector();

    const result = await getRekapHarianKolektor(admin.user.tenantId, businessDate());

    const row = result.rows.find((r) => r.collectorId === collector.user.id);
    expect(row).toMatchObject({ status: "TIDAK_ADA_SETORAN", tertagih: "0", disetor: null, selisih: null });
  });

  it("reports tertagih/disetor/selisih from a verified batch, and target for today only", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await request(app())
      .put("/api/collections/assignments")
      .set(bearer(admin.accessToken))
      .send({ assignments: [{ memberId: member.id, collectorUserId: collector.user.id }] });
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, memberId: member.id } });
    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(collector.accessToken))
      .send({ savingId: saving.id, amount: 100_000 });
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, collectorId: collector.user.id } });
    await request(app()).post(`/api/collections/batches/${batch.id}/submit`).set(bearer(collector.accessToken));
    await request(app())
      .post(`/api/collections/batches/${batch.id}/verify`)
      .set(bearer(admin.accessToken))
      .send({ receivedTotal: 90_000 });

    const today = await getRekapHarianKolektor(admin.user.tenantId, businessDate());
    const row = today.rows.find((r) => r.collectorId === collector.user.id);
    expect(row).toMatchObject({ status: "VERIFIED", tertagih: "100000", disetor: "90000", selisih: "-10000" });
    expect(row!.target).not.toBeNull();

    const yesterday = new Date(businessDate().getTime() - 86_400_000);
    const past = await getRekapHarianKolektor(admin.user.tenantId, yesterday);
    const pastRow = past.rows.find((r) => r.collectorId === collector.user.id);
    expect(pastRow!.target).toBeNull();
  });
});

describe("getTunggakanAngsuran", () => {
  it("only returns strictly-overdue installments, filterable by collector/pasar/blok", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await request(app())
      .put("/api/collections/assignments")
      .set(bearer(admin.accessToken))
      .send({ assignments: [{ memberId: member.id, collectorUserId: collector.user.id }] });
    const config = await request(app())
      .post("/api/loans/configs")
      .set(bearer(admin.accessToken))
      .send({ name: "KUR Mikro", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
    await request(app())
      .post("/api/loans")
      .set(bearer(admin.accessToken))
      .send({ memberId: member.id, loanConfigId: config.body.data.id, principalAmount: 1_000_000, termMonths: 1, disbursedAt: "2025-01-01" });
    const market = await request(app()).post("/api/market/markets").set(bearer(admin.accessToken)).send({ name: "Pasar Tunggakan" });
    const stall = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: market.body.data.id, code: "A-01", block: "A", kind: "KIOS" });
    await request(app())
      .post("/api/market/contracts")
      .set(bearer(admin.accessToken))
      .send({ stallId: stall.body.data.id, memberId: member.id, startDate: "2026-09-01", rentAmount: 100000, rentPeriod: "MONTHLY" });

    const unfiltered = await getTunggakanAngsuran(admin.user.tenantId, {});
    expect(unfiltered).toHaveLength(1);
    expect(unfiltered[0]).toMatchObject({
      memberId: member.id,
      collectorId: collector.user.id,
      marketName: "Pasar Tunggakan",
      block: "A",
      stallCode: "A-01"
    });
    expect(Number(unfiltered[0]!.daysOverdue)).toBeGreaterThan(0);

    const byCollector = await getTunggakanAngsuran(admin.user.tenantId, { collectorId: collector.user.id });
    expect(byCollector).toHaveLength(1);
    const otherCollector = await createStaffSession(admin.user.tenantId, "demo", "Kolektor", "other-kolektor@demo.test");
    const byOtherCollector = await getTunggakanAngsuran(admin.user.tenantId, { collectorId: otherCollector.user.id });
    expect(byOtherCollector).toHaveLength(0);

    const byMarket = await getTunggakanAngsuran(admin.user.tenantId, { marketId: market.body.data.id });
    expect(byMarket).toHaveLength(1);
    const byBlock = await getTunggakanAngsuran(admin.user.tenantId, { marketId: market.body.data.id, block: "B" });
    expect(byBlock).toHaveLength(0);
  });
});

describe("getTunggakanSewaRetribusi", () => {
  it("only returns strictly-overdue charges, filterable by pasar/blok/anggota", async () => {
    const admin = await setupTenant();
    const market = await request(app()).post("/api/market/markets").set(bearer(admin.accessToken)).send({ name: "Pasar Tunggakan 2" });
    const stall = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: market.body.data.id, code: "B-02", block: "B", kind: "KIOS" });
    const member = await createMemberAs(admin.accessToken);
    const overdue = await db.charge.create({
      data: {
        tenantId: admin.user.tenantId,
        unitId: market.body.data.unitId,
        memberId: member.id,
        stallId: stall.body.data.id,
        kind: "RETRIBUSI",
        sourceId: "test-overdue-1",
        periodStart: new Date("2020-01-01"),
        dueDate: new Date("2020-01-01"),
        amount: 5000,
        status: "UNPAID"
      }
    });
    await db.charge.create({
      data: {
        tenantId: admin.user.tenantId,
        unitId: market.body.data.unitId,
        memberId: member.id,
        stallId: stall.body.data.id,
        kind: "RETRIBUSI",
        sourceId: "test-not-due-yet",
        periodStart: businessDate(),
        dueDate: businessDate(),
        amount: 5000,
        status: "UNPAID"
      }
    });

    const rows = await getTunggakanSewaRetribusi(admin.user.tenantId, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chargeId: overdue.id, marketName: "Pasar Tunggakan 2", block: "B", stallCode: "B-02" });

    const byBlock = await getTunggakanSewaRetribusi(admin.user.tenantId, { marketId: market.body.data.id, block: "A" });
    expect(byBlock).toHaveLength(0);

    const byMember = await getTunggakanSewaRetribusi(admin.user.tenantId, { memberId: member.id });
    expect(byMember).toHaveLength(1);
  });
});

describe("GET /api/reports/pasar/* routes", () => {
  it("gates all three routes behind the pasar entitlement", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const rekap = await request(app()).get("/api/reports/pasar/rekap-kolektor").set(bearer(admin.accessToken));
    const angsuran = await request(app()).get("/api/reports/pasar/tunggakan-angsuran").set(bearer(admin.accessToken));
    const sewa = await request(app()).get("/api/reports/pasar/tunggakan-sewa-retribusi").set(bearer(admin.accessToken));

    for (const res of [rekap, angsuran, sewa]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FEATURE_NOT_ENTITLED");
    }
  });

  it("returns today's rekap as JSON and as a CSV download", async () => {
    const admin = await setupTenant();

    const json = await request(app()).get("/api/reports/pasar/rekap-kolektor").set(bearer(admin.accessToken));
    expect(json.status).toBe(200);
    expect(json.body.data.date).toBe(businessDate().toISOString().slice(0, 10));

    const csv = await request(app()).get("/api/reports/pasar/rekap-kolektor/csv").set(bearer(admin.accessToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("Kolektor,Target,Tertagih,Disetor,Selisih,Status");
  });

  it("returns tunggakan angsuran and sewa/retribusi as JSON", async () => {
    const admin = await setupTenant();

    const angsuran = await request(app()).get("/api/reports/pasar/tunggakan-angsuran").set(bearer(admin.accessToken));
    const sewa = await request(app()).get("/api/reports/pasar/tunggakan-sewa-retribusi").set(bearer(admin.accessToken));

    expect(angsuran.status).toBe(200);
    expect(angsuran.body.data).toEqual([]);
    expect(sewa.status).toBe(200);
    expect(sewa.body.data).toEqual([]);
  });
});
