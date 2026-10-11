import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { runWithRequestContext } from "../src/lib/request-context.js";
import { app, createMemberWithPokokSaving, setupTenant } from "./helpers.js";
import { depositToSaving } from "../src/modules/savings/service.js";
import { recordLoanPayment } from "../src/modules/loans/service.js";

/** recordAudit reads the ambient request context requireAuth normally seeds — calling a
 * service function directly (bypassing HTTP) needs to seed it by hand. */
function asActor<T>(tenantId: string, actorUserId: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ tenantId, actorUserId, requestId: "test-request", ip: null, userAgent: null }, fn);
}

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function openBatch(tenantId: string, collectorId: string) {
  return db.collectionBatch.create({
    data: { tenantId, collectorId, businessDate: new Date(new Date().toISOString().slice(0, 10)), status: "OPEN" }
  });
}

async function kasLineAccountName(tenantId: string, sourceType: string, sourceId: string) {
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { tenantId, sourceType, sourceId },
    include: { lines: { include: { account: true } } }
  });
  // The line with the larger absolute amount among debit/credit that isn't the config-specific side —
  // simplest robust check: find the line whose account is either "Kas" or "Kas di Kolektor".
  return entry.lines.find((l) => ["Kas", "Kas di Kolektor"].includes(l.account.name))?.account.name;
}

describe("depositToSaving with a collector context", () => {
  it("stamps the SavingTransaction with collectionBatchId and posts to Kas di Kolektor instead of Kas", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    // After the member's POKOK saving config exists, so its DEPOSIT mapping gets wired too.
    await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${admin.accessToken}`);
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, memberId: member.id } });
    const batch = await openBatch(admin.user.tenantId, admin.user.id);

    const transaction = await asActor(admin.user.tenantId, admin.user.id, () =>
      depositToSaving(admin.user.tenantId, saving.id, { amount: 50000 }, admin.user.id, { batchId: batch.id })
    );

    expect(transaction.collectionBatchId).toBe(batch.id);
    expect(await kasLineAccountName(admin.user.tenantId, "SAVING_TRANSACTION", transaction.id)).toBe("Kas di Kolektor");
  });

  it("posts to ordinary Kas when there's no collector context (loket deposit, unchanged)", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${admin.accessToken}`);
    const saving = await db.saving.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, memberId: member.id } });

    const transaction = await asActor(admin.user.tenantId, admin.user.id, () =>
      depositToSaving(admin.user.tenantId, saving.id, { amount: 50000 }, admin.user.id)
    );

    expect(transaction.collectionBatchId).toBeNull();
    expect(await kasLineAccountName(admin.user.tenantId, "SAVING_TRANSACTION", transaction.id)).toBe("Kas");
  });
});

describe("recordLoanPayment with a collector context", () => {
  it("stamps the LoanPayment with collectionBatchId and posts to Kas di Kolektor instead of Kas", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "KUR Mikro", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
    // After the loan config exists, so its PAYMENT_* mappings get wired too.
    await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${admin.accessToken}`);
    const loan = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.body.data.id, principalAmount: 1_000_000, termMonths: 6 });
    const batch = await openBatch(admin.user.tenantId, admin.user.id);

    const result = await asActor(admin.user.tenantId, admin.user.id, () =>
      recordLoanPayment(
        admin.user.tenantId,
        loan.body.data.id,
        { amount: new Prisma.Decimal("100000"), penalty: new Prisma.Decimal("0"), paidAt: new Date().toISOString().slice(0, 10) },
        admin.user.id,
        { batchId: batch.id }
      )
    );

    const payment = await db.loanPayment.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, loanId: loan.body.data.id } });
    expect(payment.collectionBatchId).toBe(batch.id);
    expect(await kasLineAccountName(admin.user.tenantId, "LOAN_PAYMENT", payment.id)).toBe("Kas di Kolektor");
    expect(result.status).toBe("ACTIVE");
  });
});
