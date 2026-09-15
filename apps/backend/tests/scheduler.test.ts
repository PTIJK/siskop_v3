import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import * as journal from "../src/lib/journal.js";
import { app, createMemberAs, createMemberWithPokokSaving, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.SCHEDULER_SECRET = "test-scheduler-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const TOKEN_HEADER = "x-scheduler-token";
const TOKEN = "test-scheduler-secret";

const KAS = { code: "1100", name: "Kas", category: "ASET" as const, normalBalance: "DEBIT" as const, isCashEquivalent: true };
const BEBAN_BUNGA = { code: "5100", name: "Beban Bunga Simpanan", category: "BEBAN" as const, normalBalance: "DEBIT" as const };

async function createAccountAs(accessToken: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/config/accounts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ ...KAS, ...overrides });
  return res.body.data as { id: string };
}

const KUR_MIKRO = {
  name: "KUR Mikro",
  type: "KONVENSIONAL" as const,
  rateType: "BUNGA" as const,
  rate: 12,
  maxTermMonths: 36
};

async function createLoanConfigAs(accessToken: string) {
  const res = await request(app())
    .post("/api/loans/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(KUR_MIKRO);
  return res.body.data as { id: string };
}

async function createDailySavingAs(accessToken: string, memberId: string, rate: number, initialDeposit: number) {
  const config = await request(app())
    .post("/api/savings/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Tabungan Harian", type: "SUKARELA", rateType: "BUNGA", rate, periodUnit: "DAILY" });
  const saving = await request(app())
    .post("/api/savings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ memberId, savingConfigId: config.body.data.id, initialDeposit });
  return { config: config.body.data as { id: string }, saving: saving.body.data as { id: string } };
}

describe("POST /api/scheduler/run-daily", () => {
  it("rejects a request with no scheduler token", async () => {
    const res = await request(app()).post("/api/scheduler/run-daily");
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong scheduler token", async () => {
    const res = await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, "wrong-token");
    expect(res.status).toBe(401);
  });

  it("accrues exactly one day of interest on first run and is idempotent within the same day", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const { saving } = await createDailySavingAs(admin.accessToken, member.id, 9, 1_000_000);

    const res = await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.data.savingsInterest.checked).toBe(1);
    expect(res.body.data.savingsInterest.posted).toBe(1);

    // dailyRate = 9%/360 on 1_000_000 = 250.00 (regulatory cap for savings is 9%/year)
    const afterFirstRun = await db.saving.findUnique({ where: { id: saving.id } });
    expect(Number(afterFirstRun?.balance)).toBeCloseTo(1_000_250, 2);
    expect(afterFirstRun?.lastInterestAt).not.toBeNull();

    const transaction = await db.savingTransaction.findFirst({
      where: { tenantId: admin.user.tenantId, savingId: saving.id, type: "INTEREST" }
    });
    expect(transaction).not.toBeNull();
    expect(Number(transaction?.amount)).toBeCloseTo(250, 2);
    expect(transaction?.createdBy).toBeNull();

    const res2 = await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN);
    expect(res2.body.data.savingsInterest.posted).toBe(0);
    expect(res2.body.data.savingsInterest.skipped).toBe(1);

    const afterSecondRun = await db.saving.findUnique({ where: { id: saving.id } });
    expect(Number(afterSecondRun?.balance)).toBeCloseTo(1_000_250, 2);

    const transactionCount = await db.savingTransaction.count({
      where: { tenantId: admin.user.tenantId, savingId: saving.id, type: "INTEREST" }
    });
    expect(transactionCount).toBe(1);
  });

  it("does not accrue interest for a zero-rate or MONTHLY/YEARLY-period saving", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const { saving: zeroRateSaving } = await createDailySavingAs(admin.accessToken, member.id, 0, 1_000_000);
    const monthlyConfig = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Tabungan Bulanan", type: "SUKARELA", rateType: "BUNGA", rate: 9, periodUnit: "MONTHLY" });
    const monthlySaving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: monthlyConfig.body.data.id, initialDeposit: 1_000_000 });

    const res = await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN);
    expect(res.status).toBe(200);
    // Only the zero-rate DAILY saving is checked; the MONTHLY one is out of scope entirely.
    expect(res.body.data.savingsInterest.checked).toBe(1);
    expect(res.body.data.savingsInterest.posted).toBe(0);

    const afterZeroRate = await db.saving.findUnique({ where: { id: zeroRateSaving.id } });
    expect(Number(afterZeroRate?.balance)).toBe(1_000_000);

    const afterMonthly = await db.saving.findUnique({ where: { id: monthlySaving.body.data.id } });
    expect(Number(afterMonthly?.balance)).toBe(1_000_000);
  });

  it("credits a saving only once when duplicate daily requests overlap", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const { saving } = await createDailySavingAs(admin.accessToken, member.id, 9, 1_000_000);
    const server = app();
    // Force all sweeps to obtain their initial snapshot before any can credit.
    // This reproduces scheduler redelivery across concurrent workers reliably.
    const findMany = db.saving.findMany.bind(db.saving);
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    db.saving.findMany = async args => {
      const rows = await findMany(args);
      if (++arrived === 6) release();
      await barrier;
      return rows;
    };
    let responses;
    try {
      responses = await Promise.all(Array.from({ length: 6 }, () => request(server).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN)));
    } finally { db.saving.findMany = findMany; }
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(await db.savingTransaction.count({ where: { tenantId: admin.user.tenantId, savingId: saving.id, type: "INTEREST" } })).toBe(1);
    const updated = await db.saving.findUniqueOrThrow({ where: { id: saving.id } });
    expect(updated.balance.toFixed(2)).toBe("1000250.00");
  });

  it("flips the interest journal entry from UNPOSTED_MISSING_MAPPING to POSTED once a SAVING_INTEREST mapping exists", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const { config, saving } = await createDailySavingAs(admin.accessToken, member.id, 9, 1_000_000);

    await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN);

    const transaction = await db.savingTransaction.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, savingId: saving.id, type: "INTEREST" }
    });
    const beforeEntry = await db.journalEntry.findFirst({ where: { tenantId: admin.user.tenantId, sourceId: transaction.id } });
    expect(beforeEntry?.status).toBe("UNPOSTED_MISSING_MAPPING");

    const kas = await createAccountAs(admin.accessToken);
    const beban = await createAccountAs(admin.accessToken, BEBAN_BUNGA);
    await request(app())
      .post("/api/config/account-mappings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ sourceType: "SAVING_CONFIG", sourceId: config.id, transactionKind: "SAVING_INTEREST", debitAccountId: beban.id, creditAccountId: kas.id });

    // Advance to "the next day" so the second run isn't skipped as a same-day no-op.
    await db.saving.update({
      where: { id: saving.id, tenantId: admin.user.tenantId },
      data: { lastInterestAt: new Date("2020-01-01") }
    });
    await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN);

    const secondTransaction = await db.savingTransaction.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, savingId: saving.id, type: "INTEREST" },
      orderBy: { createdAt: "desc" }
    });
    const afterEntry = await db.journalEntry.findFirst({ where: { tenantId: admin.user.tenantId, sourceId: secondTransaction.id } });
    expect(afterEntry?.status).toBe("POSTED");
  });

  it("rolls back a failed account and retries it without re-crediting successful accounts", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const first = await createDailySavingAs(admin.accessToken, member.id, 9, 1_000_000);
    const second = await createDailySavingAs(admin.accessToken, member.id, 9, 1_000_000);
    const posting = vi.spyOn(journal, "postSavingTransaction").mockRejectedValueOnce(new Error("temporary journal failure"));
    try {
      const failed = await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN);
      expect(failed.status).toBe(503);
      expect(failed.body.data.savingsInterest).toMatchObject({ posted: 1, failed: 1 });
    } finally { posting.mockRestore(); }
    const rows = await db.saving.findMany({ where: { tenantId: admin.user.tenantId, id: { in: [first.saving.id, second.saving.id] } } });
    expect(rows.filter(row => row.lastInterestAt === null)).toHaveLength(1);
    expect(rows.filter(row => row.balance.equals(1_000_000))).toHaveLength(1);
    const retry = await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN);
    expect(retry.status).toBe(200);
    expect(retry.body.data.savingsInterest).toMatchObject({ posted: 1, skipped: 1, failed: 0 });
    expect(await db.savingTransaction.count({ where: { tenantId: admin.user.tenantId, type: "INTEREST" } })).toBe(2);
  });

  it("recalculates loan KOL for an overdue loan with no payments", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const loan = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6, disbursedAt: "2025-01-25" });
    expect(loan.body.data.kolCategory).toBe("LANCAR");

    const res = await request(app()).post("/api/scheduler/run-daily").set(TOKEN_HEADER, TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.data.loanKol.checked).toBeGreaterThanOrEqual(1);

    const updated = await db.loan.findUnique({ where: { id: loan.body.data.id } });
    expect(updated?.kolCategory).not.toBe("LANCAR");
    expect(updated?.daysOverdue).toBeGreaterThan(180);
  });
});
