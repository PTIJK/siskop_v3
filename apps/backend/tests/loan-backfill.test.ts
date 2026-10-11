import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, setupTenant } from "./helpers.js";
import { backfillLoan, backfillAllLoanSchedules } from "../src/modules/loans/backfill.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function createPreF2Loan(
  accessToken: string,
  tenantId: string,
  memberId: string,
  opts: { principal: string; total: string; termMonths: number; disbursedAt: string; payments?: { amount: string; paidAt: string }[] }
) {
  const config = await request(app())
    .post("/api/loans/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "KUR Lama", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
  const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });

  // Direct DB insert — simulates a loan created before F2, with no schedule
  // (createLoan always builds one now; this is what pre-migration data looks like).
  const loan = await db.loan.create({
    data: {
      tenantId,
      unitId: unit.id,
      memberId,
      loanConfigId: config.body.data.id,
      principalAmount: opts.principal,
      totalAmount: opts.total,
      termMonths: opts.termMonths,
      monthlyPayment: new Prisma.Decimal(opts.total).div(opts.termMonths).toDecimalPlaces(2),
      remainingAmount: opts.total,
      status: "ACTIVE",
      kolCategory: "LANCAR",
      disbursedAt: new Date(opts.disbursedAt)
    }
  });

  for (const p of opts.payments ?? []) {
    await db.loanPayment.create({
      data: {
        loanId: loan.id,
        tenantId,
        amount: p.amount,
        paidAt: new Date(p.paidAt),
        createdBy: (await db.user.findFirstOrThrow({ where: { tenantId } })).id
      }
    });
  }

  return loan;
}

describe("backfillLoan", () => {
  it("builds a MONTHLY schedule from principalAmount/totalAmount/termMonths, leaving remainingAmount/status untouched", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const loan = await createPreF2Loan(admin.accessToken, admin.user.tenantId, member.id, {
      principal: "1000000",
      total: "1120000",
      termMonths: 6,
      disbursedAt: "2026-01-05"
    });

    const result = await db.$transaction((tx) => backfillLoan(tx, loan.id));
    expect(result).toEqual({ loanId: loan.id, installmentsCreated: 6, paymentsReallocated: 0 });

    const installments = await db.loanInstallment.findMany({ where: { loanId: loan.id, tenantId: admin.user.tenantId }, orderBy: { seq: "asc" } });
    expect(installments).toHaveLength(6);
    const sumPrincipal = installments.reduce((s, i) => s.plus(i.principalDue), new Prisma.Decimal(0));
    const sumInterest = installments.reduce((s, i) => s.plus(i.interestDue), new Prisma.Decimal(0));
    expect(sumPrincipal.toString()).toBe("1000000");
    expect(sumInterest.toString()).toBe("120000");

    const after = await db.loan.findFirstOrThrow({ where: { id: loan.id, tenantId: admin.user.tenantId } });
    expect(after.remainingAmount.toString()).toBe("1120000");
    expect(after.status).toBe("ACTIVE");
    expect(after.maturityDate).not.toBeNull();
  });

  it("replays existing payments against the new schedule, oldest first", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const loan = await createPreF2Loan(admin.accessToken, admin.user.tenantId, member.id, {
      principal: "600000",
      total: "600000", // rate 0 for a clean 100000/installment schedule
      termMonths: 6,
      disbursedAt: "2026-01-05",
      payments: [
        { amount: "100000", paidAt: "2026-02-05" },
        { amount: "150000", paidAt: "2026-03-05" }
      ]
    });

    const result = await db.$transaction((tx) => backfillLoan(tx, loan.id));
    expect(result?.paymentsReallocated).toBe(2);

    const installments = await db.loanInstallment.findMany({
      where: { loanId: loan.id, tenantId: admin.user.tenantId },
      orderBy: { seq: "asc" }
    });
    // 250000 paid total against 6x100000 installments: #1 and #2 PAID, #3 PARTIAL (50000), rest UNPAID.
    expect(installments[0].status).toBe("PAID");
    expect(installments[1].status).toBe("PAID");
    expect(installments[2].status).toBe("PARTIAL");
    expect(installments[2].principalPaid.plus(installments[2].interestPaid).toString()).toBe("50000");
    expect(installments[3].status).toBe("UNPAID");
  });

  it("is idempotent: a loan already backfilled is left untouched", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const loan = await createPreF2Loan(admin.accessToken, admin.user.tenantId, member.id, {
      principal: "1000000",
      total: "1000000",
      termMonths: 4,
      disbursedAt: "2026-01-05"
    });

    await db.$transaction((tx) => backfillLoan(tx, loan.id));
    const second = await db.$transaction((tx) => backfillLoan(tx, loan.id));
    expect(second).toBeNull();

    const installments = await db.loanInstallment.findMany({ where: { loanId: loan.id, tenantId: admin.user.tenantId } });
    expect(installments).toHaveLength(4);
  });
});

describe("backfillAllLoanSchedules", () => {
  it("processes every loan with no schedule and skips ones that already have one", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await createPreF2Loan(admin.accessToken, admin.user.tenantId, member.id, {
      principal: "500000",
      total: "500000",
      termMonths: 3,
      disbursedAt: "2026-01-05"
    });

    const member2 = await createMemberWithPokokSaving(admin.accessToken, { nik: "9999999999999999" });
    const config = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "KUR Baru", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
    // Created through the real API — already has a schedule, must be skipped.
    await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member2.id, loanConfigId: config.body.data.id, principalAmount: 500_000, termMonths: 3 });

    const result = await backfillAllLoanSchedules();
    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0); // already-backfilled loans are excluded from the candidate query, not counted as skipped
    expect(result.failed).toBe(0);

    const remaining = await withoutTenantScope(() => db.loan.findMany({ where: { installments: { none: {} } } }));
    expect(remaining).toHaveLength(0);
  });
});
