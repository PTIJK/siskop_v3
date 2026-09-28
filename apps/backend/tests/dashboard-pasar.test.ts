import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, createStaffSession, setupTenant } from "./helpers.js";
import { getPasarDashboard } from "../src/modules/dashboard/service.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

describe("getPasarDashboard", () => {
  it("sums today's setoran, counts unverified batches, and totals overdue loans + charges", async () => {
    const admin = await setupTenant();
    await request(app()).post("/api/config/accounts/generate-standard").set(bearer(admin.accessToken));
    const collector = await createStaffSession(admin.user.tenantId, "demo", "Kolektor", "kolektor@demo.test");
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await request(app())
      .put("/api/collections/assignments")
      .set(bearer(admin.accessToken))
      .send({ assignments: [{ memberId: member.id, collectorUserId: collector.user.id }] });
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, memberId: member.id } });
    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(collector.accessToken))
      .send({ savingId: saving.id, amount: 50_000 });
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, collectorId: collector.user.id } });
    await request(app()).post(`/api/collections/batches/${batch.id}/submit`).set(bearer(collector.accessToken));

    const market = await request(app()).post("/api/market/markets").set(bearer(admin.accessToken)).send({ name: "Pasar Dashboard" });
    const stall = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: market.body.data.id, code: "A-01", kind: "KIOS" });
    const otherMember = await createMemberWithPokokSaving(admin.accessToken, { nik: "3171234567890099" });
    await db.charge.create({
      data: {
        tenantId: admin.user.tenantId,
        unitId: market.body.data.unitId,
        memberId: otherMember.id,
        stallId: stall.body.data.id,
        kind: "RETRIBUSI",
        sourceId: "dash-overdue-1",
        periodStart: new Date("2020-01-01"),
        dueDate: new Date("2020-01-01"),
        amount: 7000,
        status: "UNPAID"
      }
    });

    const config = await request(app())
      .post("/api/loans/configs")
      .set(bearer(admin.accessToken))
      .send({ name: "KUR Mikro", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
    await request(app())
      .post("/api/loans")
      .set(bearer(admin.accessToken))
      .send({ memberId: otherMember.id, loanConfigId: config.body.data.id, principalAmount: 1_000_000, termMonths: 1, disbursedAt: "2025-01-01" });
    const installment = await db.loanInstallment.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const loanTunggakan = installment.principalDue.plus(installment.interestDue).toString();

    const result = await getPasarDashboard(admin.user.tenantId);

    expect(result.setoranHariIni).toBe("50000");
    expect(result.batchBelumDiverifikasi).toBe(1);
    expect(result.totalTunggakan).toBe((Number(loanTunggakan) + 7000).toString());
  });

  it("returns zeros for a tenant with no pasar activity", async () => {
    const admin = await setupTenant();

    const result = await getPasarDashboard(admin.user.tenantId);

    expect(result).toEqual({ setoranHariIni: "0", batchBelumDiverifikasi: 0, totalTunggakan: "0" });
  });
});

describe("GET /api/dashboard/pasar", () => {
  it("gates behind the pasar entitlement", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const res = await request(app()).get("/api/dashboard/pasar").set(bearer(admin.accessToken));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("returns the pasar widgets for an entitled tenant", async () => {
    const admin = await setupTenant();

    const res = await request(app()).get("/api/dashboard/pasar").set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ setoranHariIni: "0", batchBelumDiverifikasi: 0, totalTunggakan: "0" });
  });
});
