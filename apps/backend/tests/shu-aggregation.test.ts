import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { getShuDistribution } from "../src/modules/reports/regulatory-service.js";
import { app, createMemberAs, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});
beforeEach(async () => { await db.tenant.deleteMany({}); });

describe("SHU savings balances", () => {
  it("reconstructs both period boundaries per member across savings types", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    const member = await createMemberAs(admin.accessToken);
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
    await db.shuDistributionConfig.create({ data: { tenantId, jasaSimpananPercent: 50, jasaPinjamanPercent: 0, cadanganPercent: 40, lainnyaPercent: 10 } });
    const kas = await db.account.create({ data: { tenantId, code: "PERF-KAS", name: "Kas", category: "ASET", normalBalance: "DEBIT" } });
    const income = await db.account.create({ data: { tenantId, code: "PERF-INCOME", name: "Income", category: "PENDAPATAN", normalBalance: "KREDIT" } });
    await db.journalEntry.create({ data: { tenantId, entryDate: new Date("2025-06-01T00:00:00Z"), sourceType: "MANUAL", description: "Test income", status: "POSTED", lines: { create: [{ tenantId, accountId: kas.id, debit: 1000 }, { tenantId, accountId: income.id, credit: 1000 }] } } });
    const pokok = await db.savingConfig.create({ data: { tenantId, name: "Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" } });
    const sukarela = await db.savingConfig.create({ data: { tenantId, name: "Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" } });
    const first = await db.saving.create({ data: { tenantId, unitId: unit.id, memberId: member.id, savingConfigId: pokok.id, balance: 110 } });
    const second = await db.saving.create({ data: { tenantId, unitId: unit.id, memberId: member.id, savingConfigId: sukarela.id, balance: 70 } });
    await db.savingTransaction.createMany({ data: [
      { tenantId, savingId: first.id, type: "DEPOSIT", amount: 40, createdAt: new Date("2025-06-01T00:00:00Z") },
      { tenantId, savingId: first.id, type: "WITHDRAWAL", amount: 30, createdAt: new Date("2026-01-01T00:00:00Z") },
      { tenantId, savingId: second.id, type: "DEPOSIT", amount: 20, createdAt: new Date("2026-01-01T00:00:00Z") }
    ] });
    const result = await getShuDistribution(tenantId, new Date("2025-01-01T00:00:00Z"), new Date("2025-12-31T23:59:59Z"));
    const row = result.anggota.find((item) => item.memberId === member.id);
    expect(row).toMatchObject({ avgSavingsBalance: "170", jasaSimpanan: "500", shuPokokWajib: "352.94", shuSukarela: "147.06" });
    const secondMember = await createMemberAs(admin.accessToken, { nik: "3171234567899999" });
    const query = { from: "2025-01-01", to: "2025-12-31" };
    const get = (page?: number) => request(app()).get("/api/reports/regulatory/shu-distribution")
      .query({ ...query, ...(page ? { page, limit: 1 } : {}) }).set("Authorization", `Bearer ${admin.accessToken}`);
    const [full, firstPage, secondPage, invalid] = await Promise.all([
      get(), get(1), get(2), request(app()).get("/api/reports/regulatory/shu-distribution")
        .query({ ...query, page: 1, limit: 201 }).set("Authorization", `Bearer ${admin.accessToken}`)
    ]);
    expect(full.status).toBe(200);
    expect(full.body.data.anggota.map((item: { memberId: string }) => item.memberId)).toEqual([member.id, secondMember.id].sort());
    expect(firstPage.status).toBe(200);
    expect(secondPage.status).toBe(200);
    expect(invalid.status).toBe(422);
    expect(firstPage.body.meta).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(secondPage.body.meta).toMatchObject({ page: 2, limit: 1, total: 2 });
    expect([...firstPage.body.data.anggota, ...secondPage.body.data.anggota]).toEqual(full.body.data.anggota);
    expect(firstPage.body.data.totalDibagikanKeAnggota).toBe(full.body.data.totalDibagikanKeAnggota);

  });
});
