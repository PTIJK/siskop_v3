import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, createStaffSession, setupTenant } from "./helpers.js";

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

async function assign(accessToken: string, memberId: string, collectorUserId: string) {
  return request(app())
    .put("/api/collections/assignments")
    .set(bearer(accessToken))
    .send({ assignments: [{ memberId, collectorUserId }] });
}

describe("PUT /api/collections/assignments", () => {
  it("assigns a member to a Kolektor (Manager)", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const res = await assign(admin.accessToken, member.id, collector.user.id);

    expect(res.status).toBe(200);
    const row = await db.collectorAssignment.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, memberId: member.id } });
    expect(row.userId).toBe(collector.user.id);
  });

  it("re-assigning a member updates their collector rather than erroring", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const collector2 = await createStaffSession(admin.user.tenantId, "demo", "Kolektor", "kolektor2@demo.test");
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await assign(admin.accessToken, member.id, collector.user.id);

    const res = await assign(admin.accessToken, member.id, collector2.user.id);

    expect(res.status).toBe(200);
    const row = await db.collectorAssignment.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, memberId: member.id } });
    expect(row.userId).toBe(collector2.user.id);
  });

  it("rejects a collectorUserId that isn't a Kolektor", async () => {
    const { admin } = await setupTenantWithCollector();
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const res = await assign(admin.accessToken, member.id, teller.user.id);

    expect(res.status).toBe(422);
  });

  it("403s a Kolektor trying to assign (not their permission)", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const res = await assign(collector.accessToken, member.id, collector.user.id);

    expect(res.status).toBe(403);
  });
});

describe("GET /api/collections/today", () => {
  it("lists a binaan member's oldest overdue installment, sorted, and nothing for a member with no loan", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const memberWithLoan = await createMemberWithPokokSaving(admin.accessToken, { nik: "1111111111111111" });
    const memberNoLoan = await createMemberWithPokokSaving(admin.accessToken, { nik: "2222222222222222" });
    await assign(admin.accessToken, memberWithLoan.id, collector.user.id);
    await assign(admin.accessToken, memberNoLoan.id, collector.user.id);

    const config = await request(app())
      .post("/api/loans/configs")
      .set(bearer(admin.accessToken))
      .send({ name: "KUR Mikro", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
    await request(app())
      .post("/api/loans")
      .set(bearer(admin.accessToken))
      .send({ memberId: memberWithLoan.id, loanConfigId: config.body.data.id, principalAmount: 1_000_000, termMonths: 6, disbursedAt: "2025-01-01" });

    const res = await request(app()).get("/api/collections/today").set(bearer(collector.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const withLoan = res.body.data.find((i: { memberId: string }) => i.memberId === memberWithLoan.id);
    const withoutLoan = res.body.data.find((i: { memberId: string }) => i.memberId === memberNoLoan.id);
    expect(withLoan.loanId).toBeTruthy();
    expect(withLoan.daysOverdue).toBeGreaterThan(0);
    expect(withoutLoan.loanId).toBeNull();
  });

  it("never includes another collector's binaan", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const collector2 = await createStaffSession(admin.user.tenantId, "demo", "Kolektor", "kolektor2@demo.test");
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await assign(admin.accessToken, member.id, collector2.user.id);

    const res = await request(app()).get("/api/collections/today").set(bearer(collector.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it("sorts binaan by pasar, then blok, then kode kios, with stall-less members last (by name)", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const memberZBlokBA01 = await createMemberWithPokokSaving(admin.accessToken, { nik: "3000000000000001", fullName: "Zaenal" });
    const memberABlokAB02 = await createMemberWithPokokSaving(admin.accessToken, { nik: "3000000000000002", fullName: "Amir" });
    const memberABlokAA01 = await createMemberWithPokokSaving(admin.accessToken, { nik: "3000000000000003", fullName: "Budi" });
    const memberNoStall = await createMemberWithPokokSaving(admin.accessToken, { nik: "3000000000000004", fullName: "Agus" });
    for (const m of [memberZBlokBA01, memberABlokAB02, memberABlokAA01, memberNoStall]) {
      await assign(admin.accessToken, m.id, collector.user.id);
    }

    const marketA = await request(app()).post("/api/market/markets").set(bearer(admin.accessToken)).send({ name: "Pasar A" });
    const marketZ = await request(app()).post("/api/market/markets").set(bearer(admin.accessToken)).send({ name: "Pasar Z" });
    const stallZBA01 = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: marketZ.body.data.id, code: "A-01", block: "B", kind: "KIOS" });
    const stallABB02 = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: marketA.body.data.id, code: "B-02", block: "A", kind: "KIOS" });
    const stallABA01 = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: marketA.body.data.id, code: "A-01", block: "A", kind: "KIOS" });
    await request(app())
      .post("/api/market/contracts")
      .set(bearer(admin.accessToken))
      .send({ stallId: stallZBA01.body.data.id, memberId: memberZBlokBA01.id, startDate: "2026-09-01", rentAmount: 100000, rentPeriod: "MONTHLY" });
    await request(app())
      .post("/api/market/contracts")
      .set(bearer(admin.accessToken))
      .send({ stallId: stallABB02.body.data.id, memberId: memberABlokAB02.id, startDate: "2026-09-01", rentAmount: 100000, rentPeriod: "MONTHLY" });
    await request(app())
      .post("/api/market/contracts")
      .set(bearer(admin.accessToken))
      .send({ stallId: stallABA01.body.data.id, memberId: memberABlokAA01.id, startDate: "2026-09-01", rentAmount: 100000, rentPeriod: "MONTHLY" });

    const res = await request(app()).get("/api/collections/today").set(bearer(collector.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.map((i: { memberId: string }) => i.memberId)).toEqual([
      memberABlokAA01.id,
      memberABlokAB02.id,
      memberZBlokBA01.id,
      memberNoStall.id
    ]);
  });

  it("exposes each binaan's pasar/blok/kode kios for the mobile grouping view (koperasi pasar F6), null for a stall-less binaan", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const memberWithStall = await createMemberWithPokokSaving(admin.accessToken, { nik: "3000000000000010" });
    const memberNoStall = await createMemberWithPokokSaving(admin.accessToken, { nik: "3000000000000011" });
    await assign(admin.accessToken, memberWithStall.id, collector.user.id);
    await assign(admin.accessToken, memberNoStall.id, collector.user.id);
    const market = await request(app()).post("/api/market/markets").set(bearer(admin.accessToken)).send({ name: "Pasar Lokasi" });
    const stall = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: market.body.data.id, code: "C-09", block: "C", kind: "KIOS" });
    await request(app())
      .post("/api/market/contracts")
      .set(bearer(admin.accessToken))
      .send({ stallId: stall.body.data.id, memberId: memberWithStall.id, startDate: "2026-09-01", rentAmount: 100000, rentPeriod: "MONTHLY" });

    const res = await request(app()).get("/api/collections/today").set(bearer(collector.accessToken));

    const withStall = res.body.data.find((i: { memberId: string }) => i.memberId === memberWithStall.id);
    const withoutStall = res.body.data.find((i: { memberId: string }) => i.memberId === memberNoStall.id);
    expect(withStall.location).toEqual({ marketName: "Pasar Lokasi", block: "C", stallCode: "C-09" });
    expect(withoutStall.location).toBeNull();
  });

  it("includes a binaan's open sewa/retribusi charges (koperasi pasar F6)", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await assign(admin.accessToken, member.id, collector.user.id);
    const market = await request(app()).post("/api/market/markets").set(bearer(admin.accessToken)).send({ name: "Pasar Today" });
    const stall = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: market.body.data.id, code: "A-01", kind: "KIOS" });
    const charge = await db.charge.create({
      data: {
        tenantId: admin.user.tenantId,
        unitId: market.body.data.unitId,
        memberId: member.id,
        stallId: stall.body.data.id,
        kind: "RETRIBUSI",
        sourceId: "test-today-source",
        periodStart: new Date("2026-09-27"),
        dueDate: new Date("2026-09-27"),
        amount: 5000,
        paidAmount: 2000,
        status: "PARTIAL"
      }
    });

    const res = await request(app()).get("/api/collections/today").set(bearer(collector.accessToken));

    expect(res.status).toBe(200);
    const item = res.body.data.find((i: { memberId: string }) => i.memberId === member.id);
    expect(item.charges).toHaveLength(1);
    expect(item.charges[0]).toMatchObject({ chargeId: charge.id, kind: "RETRIBUSI", amountDue: "3000" });
  });

  it("does not include a fully paid charge", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await assign(admin.accessToken, member.id, collector.user.id);
    const market = await request(app()).post("/api/market/markets").set(bearer(admin.accessToken)).send({ name: "Pasar Today 2" });
    const stall = await request(app())
      .post("/api/market/stalls")
      .set(bearer(admin.accessToken))
      .send({ marketId: market.body.data.id, code: "A-01", kind: "KIOS" });
    await db.charge.create({
      data: {
        tenantId: admin.user.tenantId,
        unitId: market.body.data.unitId,
        memberId: member.id,
        stallId: stall.body.data.id,
        kind: "RETRIBUSI",
        sourceId: "test-today-paid",
        periodStart: new Date("2026-09-27"),
        dueDate: new Date("2026-09-27"),
        amount: 5000,
        paidAmount: 5000,
        status: "PAID"
      }
    });

    const res = await request(app()).get("/api/collections/today").set(bearer(collector.accessToken));

    const item = res.body.data.find((i: { memberId: string }) => i.memberId === member.id);
    expect(item.charges).toHaveLength(0);
  });

  it("includes the id of a binaan's active daily saving account, and null when they have none", async () => {
    const { admin, collector } = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await assign(admin.accessToken, member.id, collector.user.id);
    const dailyConfig = await request(app())
      .post("/api/savings/configs")
      .set(bearer(admin.accessToken))
      .send({ name: "Tabungan Harian", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "DAILY" });
    const dailySaving = await request(app())
      .post("/api/savings")
      .set(bearer(admin.accessToken))
      .send({ memberId: member.id, savingConfigId: dailyConfig.body.data.id, initialDeposit: 0 });

    const res = await request(app()).get("/api/collections/today").set(bearer(collector.accessToken));

    const item = res.body.data.find((i: { memberId: string }) => i.memberId === member.id);
    expect(item.dailySavingId).toBe(dailySaving.body.data.id);
  });
});

describe("POST /api/collections/savings-deposit and /loan-payment", () => {
  async function setupBinaanWithLoan() {
    const ctx = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(ctx.admin.accessToken);
    await assign(ctx.admin.accessToken, member.id, ctx.collector.user.id);
    const config = await request(app())
      .post("/api/loans/configs")
      .set(bearer(ctx.admin.accessToken))
      .send({ name: "KUR Mikro", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
    const loan = await request(app())
      .post("/api/loans")
      .set(bearer(ctx.admin.accessToken))
      .send({ memberId: member.id, loanConfigId: config.body.data.id, principalAmount: 1_000_000, termMonths: 6 });
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, memberId: member.id } });
    return { ...ctx, member, loanId: loan.body.data.id as string, savingId: saving.id };
  }

  it("records a deposit for a binaan member, opens a batch, and accrues expectedTotal", async () => {
    const ctx = await setupBinaanWithLoan();

    const res = await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: ctx.savingId, amount: 50_000 });

    expect(res.status).toBe(201);
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, collectorId: ctx.collector.user.id } });
    expect(batch.status).toBe("OPEN");
    expect(batch.expectedTotal.toString()).toBe("50000");
  });

  it("accrues a loan payment into the same day's batch as a prior deposit", async () => {
    const ctx = await setupBinaanWithLoan();
    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: ctx.savingId, amount: 50_000 });

    const res = await request(app())
      .post("/api/collections/loan-payment")
      .set(bearer(ctx.collector.accessToken))
      .send({ loanId: ctx.loanId, amount: 30_000 });

    expect(res.status).toBe(201);
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, collectorId: ctx.collector.user.id } });
    expect(batch.expectedTotal.toString()).toBe("80000");
  });

  it("403s a deposit for a member not assigned to this collector", async () => {
    const ctx = await setupTenantWithCollector();
    const other = await createMemberWithPokokSaving(ctx.admin.accessToken); // never assigned
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, memberId: other.id } });

    const res = await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: saving.id, amount: 10_000 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_ASSIGNED_COLLECTOR");
  });

  it("404s a saving belonging to another tenant", async () => {
    const ctx = await setupBinaanWithLoan();
    const other = await setupTenant({ slug: "other", registrationNo: "KOP-OTHER" });
    const otherMember = await createMemberWithPokokSaving(other.accessToken);
    const otherSaving = await db.saving.findFirstOrThrow({ where: { tenantId: other.user.tenantId, memberId: otherMember.id } });

    const res = await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: otherSaving.id, amount: 10_000 });

    expect(res.status).toBe(404);
  });

  it("409s a transaction once today's batch has been submitted", async () => {
    const ctx = await setupBinaanWithLoan();
    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: ctx.savingId, amount: 50_000 });
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, collectorId: ctx.collector.user.id } });
    await request(app()).post(`/api/collections/batches/${batch.id}/submit`).set(bearer(ctx.collector.accessToken));

    const res = await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: ctx.savingId, amount: 10_000 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BATCH_NOT_OPEN");
  });
});

describe("POST /api/collections/batches/:id/submit", () => {
  it("moves OPEN to SUBMITTED for the owning collector only", async () => {
    const ctx = await (async () => {
      const setup = await setupTenantWithCollector();
      const member = await createMemberWithPokokSaving(setup.admin.accessToken);
      await assign(setup.admin.accessToken, member.id, setup.collector.user.id);
      const saving = await db.saving.findFirstOrThrow({ where: { tenantId: setup.admin.user.tenantId, memberId: member.id } });
      await request(app())
        .post("/api/collections/savings-deposit")
        .set(bearer(setup.collector.accessToken))
        .send({ savingId: saving.id, amount: 10_000 });
      return setup;
    })();
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, collectorId: ctx.collector.user.id } });

    const other = await createStaffSession(ctx.admin.user.tenantId, "demo", "Kolektor", "other-kolektor@demo.test");
    const forbidden = await request(app()).post(`/api/collections/batches/${batch.id}/submit`).set(bearer(other.accessToken));
    expect(forbidden.status).toBe(403);

    const res = await request(app()).post(`/api/collections/batches/${batch.id}/submit`).set(bearer(ctx.collector.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("SUBMITTED");

    const again = await request(app()).post(`/api/collections/batches/${batch.id}/submit`).set(bearer(ctx.collector.accessToken));
    expect(again.status).toBe(409);
  });
});

describe("POST /api/collections/batches/:id/verify", () => {
  async function setupSubmittedBatch(depositAmount: number) {
    const setup = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(setup.admin.accessToken);
    await assign(setup.admin.accessToken, member.id, setup.collector.user.id);
    // After the member's POKOK saving config exists, so its DEPOSIT mapping gets wired too
    // (setupTenantWithCollector's own generate-standard call ran before this config existed).
    await request(app()).post("/api/config/accounts/generate-standard").set(bearer(setup.admin.accessToken));
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: setup.admin.user.tenantId, memberId: member.id } });
    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(setup.collector.accessToken))
      .send({ savingId: saving.id, amount: depositAmount });
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: setup.admin.user.tenantId, collectorId: setup.collector.user.id } });
    await request(app()).post(`/api/collections/batches/${batch.id}/submit`).set(bearer(setup.collector.accessToken));
    return { ...setup, batchId: batch.id };
  }

  it("rejects the collector verifying their own batch", async () => {
    const ctx = await setupSubmittedBatch(100_000);

    const res = await request(app())
      .post(`/api/collections/batches/${ctx.batchId}/verify`)
      .set(bearer(ctx.collector.accessToken))
      .send({ receivedTotal: 100_000 });

    expect(res.status).toBe(403);
  });

  it("verifies a shortfall of Rp10.000: Kas di Kolektor discharges to 0, Piutang Kolektor gets the shortfall, ledger stays balanced", async () => {
    const ctx = await setupSubmittedBatch(100_000);

    const res = await request(app())
      .post(`/api/collections/batches/${ctx.batchId}/verify`)
      .set(bearer(ctx.admin.accessToken))
      .send({ receivedTotal: 90_000 });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("VERIFIED");
    expect(res.body.data.variance).toBe("-10000");

    const balanceOf = async (name: string) => {
      const account = await db.account.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, name } });
      const lines = await db.journalLine.findMany({ where: { tenantId: ctx.admin.user.tenantId, accountId: account.id } });
      return lines.reduce((s, l) => s.plus(l.debit).minus(l.credit), new Prisma.Decimal(0));
    };

    expect((await balanceOf("Kas di Kolektor")).toString()).toBe("0");
    expect((await balanceOf("Piutang Kolektor")).toString()).toBe("10000");
  });

  it("rejects verifying a batch that hasn't been submitted yet", async () => {
    const setup = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(setup.admin.accessToken);
    await assign(setup.admin.accessToken, member.id, setup.collector.user.id);
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: setup.admin.user.tenantId, memberId: member.id } });
    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(setup.collector.accessToken))
      .send({ savingId: saving.id, amount: 10_000 });
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: setup.admin.user.tenantId, collectorId: setup.collector.user.id } });

    const res = await request(app())
      .post(`/api/collections/batches/${batch.id}/verify`)
      .set(bearer(setup.admin.accessToken))
      .send({ receivedTotal: 10_000 });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/collections/batches", () => {
  it("filters by status", async () => {
    const ctx = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(ctx.admin.accessToken);
    await assign(ctx.admin.accessToken, member.id, ctx.collector.user.id);
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, memberId: member.id } });
    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: saving.id, amount: 10_000 });

    const open = await request(app()).get("/api/collections/batches?status=OPEN").set(bearer(ctx.admin.accessToken));
    const verified = await request(app()).get("/api/collections/batches?status=VERIFIED").set(bearer(ctx.admin.accessToken));

    expect(open.body.data).toHaveLength(1);
    expect(verified.body.data).toHaveLength(0);
  });
});

describe("POST /api/collections/charge-payment", () => {
  async function setupBinaanWithCharge() {
    const ctx = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(ctx.admin.accessToken);
    await assign(ctx.admin.accessToken, member.id, ctx.collector.user.id);
    const market = await request(app())
      .post("/api/market/markets")
      .set(bearer(ctx.admin.accessToken))
      .send({ name: "Pasar Kolektor" });
    const stall = await request(app())
      .post("/api/market/stalls")
      .set(bearer(ctx.admin.accessToken))
      .send({ marketId: market.body.data.id, code: "A-01", kind: "KIOS" });
    // After the market exists, so its JASA/pasar mapping block gets wired too
    // (setupTenantWithCollector's own generate-standard call ran before it existed).
    await request(app()).post("/api/config/accounts/generate-standard").set(bearer(ctx.admin.accessToken));
    const charge = await db.charge.create({
      data: {
        tenantId: ctx.admin.user.tenantId,
        unitId: market.body.data.unitId,
        memberId: member.id,
        stallId: stall.body.data.id,
        kind: "RETRIBUSI",
        sourceId: "test-source-1",
        periodStart: new Date("2026-09-26"),
        dueDate: new Date("2026-09-26"),
        amount: 5000
      }
    });
    return { ...ctx, member, chargeId: charge.id };
  }

  it("records a charge payment for a binaan member, opens a batch, and accrues expectedTotal", async () => {
    const ctx = await setupBinaanWithCharge();

    const res = await request(app())
      .post("/api/collections/charge-payment")
      .set(bearer(ctx.collector.accessToken))
      .send({ chargeId: ctx.chargeId, amount: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PAID");

    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, collectorId: ctx.collector.user.id } });
    expect(batch.expectedTotal.toString()).toBe("5000");

    const payment = await db.chargePayment.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, chargeId: ctx.chargeId } });
    expect(payment.collectionBatchId).toBe(batch.id);

    const entry = await db.journalEntry.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, sourceType: "CHARGE_PAYMENT" } });
    const kasDiKolektor = await db.account.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, name: "Kas di Kolektor" } });
    const line = await db.journalLine.findFirstOrThrow({
      where: { tenantId: ctx.admin.user.tenantId, journalEntryId: entry.id, accountId: kasDiKolektor.id }
    });
    expect(line.debit.toString()).toBe("5000");
  });

  it("403s a charge payment for a member not assigned to this collector", async () => {
    const ctx = await setupBinaanWithCharge();
    const other = await createStaffSession(ctx.admin.user.tenantId, "demo", "Kolektor", "other-charge-kolektor@demo.test");

    const res = await request(app())
      .post("/api/collections/charge-payment")
      .set(bearer(other.accessToken))
      .send({ chargeId: ctx.chargeId, amount: 5000 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_ASSIGNED_COLLECTOR");
  });

  it("404s a charge belonging to another tenant", async () => {
    const ctx = await setupBinaanWithCharge();
    const other = await setupTenant({ slug: "other-pasar", registrationNo: "KOP-OTHER-PASAR" });

    const res = await request(app())
      .post("/api/collections/charge-payment")
      .set(bearer(other.accessToken))
      .send({ chargeId: ctx.chargeId, amount: 5000 });

    expect(res.status).toBe(404);
  });
});

describe("Idempotency-Key on collector writes (koperasi pasar F6)", () => {
  it("replays the first response and does not double-book a deposit sent twice with the same key", async () => {
    const ctx = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(ctx.admin.accessToken);
    await assign(ctx.admin.accessToken, member.id, ctx.collector.user.id);
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, memberId: member.id } });

    const first = await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .set("Idempotency-Key", "mobile-retry-1")
      .send({ savingId: saving.id, amount: 50_000 });
    const second = await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .set("Idempotency-Key", "mobile-retry-1")
      .send({ savingId: saving.id, amount: 50_000 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    // 2, not 1: createMemberWithPokokSaving's own initial deposit plus this one real collector
    // deposit — the replayed second request must not add a third.
    const count = await db.savingTransaction.count({ where: { tenantId: ctx.admin.user.tenantId, savingId: saving.id, type: "DEPOSIT" } });
    expect(count).toBe(2);
    const batch = await db.collectionBatch.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, collectorId: ctx.collector.user.id } });
    expect(batch.expectedTotal.toString()).toBe("50000");
  });

  it("books a second deposit when no key is sent", async () => {
    const ctx = await setupTenantWithCollector();
    const member = await createMemberWithPokokSaving(ctx.admin.accessToken);
    await assign(ctx.admin.accessToken, member.id, ctx.collector.user.id);
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: ctx.admin.user.tenantId, memberId: member.id } });

    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: saving.id, amount: 50_000 });
    await request(app())
      .post("/api/collections/savings-deposit")
      .set(bearer(ctx.collector.accessToken))
      .send({ savingId: saving.id, amount: 50_000 });

    // 3: createMemberWithPokokSaving's own initial deposit plus these 2 real collector deposits.
    const count = await db.savingTransaction.count({ where: { tenantId: ctx.admin.user.tenantId, savingId: saving.id, type: "DEPOSIT" } });
    expect(count).toBe(3);
  });
});
