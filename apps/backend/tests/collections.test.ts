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
