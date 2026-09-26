import { db, type TxClient } from "../../lib/db.js";
import { buildSchedule } from "../../lib/installment-schedule.js";
import { loadOperatingCalendar } from "../../lib/operating-calendar.js";
import { allocatePayment } from "../../lib/loan-allocation.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";

export interface BackfillResult {
  loanId: string;
  installmentsCreated: number;
  paymentsReallocated: number;
}

/**
 * Builds a MONTHLY schedule for one pre-F2 loan from its existing
 * principalAmount/totalAmount/termMonths/disbursedAt — none of which this
 * touches, so remainingAmount/status/kolCategory stay exactly what they
 * were — and replays its existing LoanPayment rows against that schedule,
 * oldest paidAt first, through the same allocatePayment() a real payment
 * uses. Idempotent: a loan that already has installments (created by
 * createLoan since F2, or backfilled before) is left untouched.
 */
export async function backfillLoan(tx: TxClient, loanId: string): Promise<BackfillResult | null> {
  const loan = await tx.loan.findUniqueOrThrow({
    where: { id: loanId },
    include: { installments: true, payments: { orderBy: { paidAt: "asc" } } }
  });
  if (loan.installments.length > 0) return null;

  const disbursedAt = loan.disbursedAt ?? loan.createdAt;
  const calendar = await loadOperatingCalendar(tx, loan.tenantId);
  const schedule = buildSchedule({
    principal: loan.principalAmount,
    totalAmount: loan.totalAmount,
    frequency: "MONTHLY",
    count: loan.termMonths,
    disbursedAt,
    calendar,
    roundToRp500: false
  });
  const firstInstallment = schedule[0]!;
  const lastInstallment = schedule[schedule.length - 1]!;

  await tx.loanInstallment.createMany({
    data: schedule.map((s) => ({
      tenantId: loan.tenantId,
      loanId: loan.id,
      seq: s.seq,
      dueDate: s.dueDate,
      principalDue: s.principalDue,
      interestDue: s.interestDue
    }))
  });

  await tx.loan.update({
    where: { id: loan.id, tenantId: loan.tenantId },
    data: {
      installmentAmount: firstInstallment.principalDue.plus(firstInstallment.interestDue),
      maturityDate: lastInstallment.dueDate
    }
  });

  let installments = await tx.loanInstallment.findMany({
    where: { loanId: loan.id, tenantId: loan.tenantId },
    orderBy: { seq: "asc" }
  });

  for (const payment of loan.payments) {
    await allocatePayment(tx, {
      tenantId: loan.tenantId,
      loan: { installments, principalAmount: loan.principalAmount, totalAmount: loan.totalAmount },
      paymentId: payment.id,
      amount: payment.amount,
      paidAt: payment.paidAt
    });
    // allocatePayment mutated the DB rows in place; re-read so the next
    // payment's allocation sees this one's principalPaid/interestPaid.
    installments = await tx.loanInstallment.findMany({
      where: { loanId: loan.id, tenantId: loan.tenantId },
      orderBy: { seq: "asc" }
    });
  }

  return { loanId: loan.id, installmentsCreated: schedule.length, paymentsReallocated: loan.payments.length };
}

/**
 * Runs backfillLoan over every loan with no schedule yet, tenant-wide (the
 * scheduler/one-off-script use) or scoped to one tenant. One transaction per
 * loan, so a single failure doesn't roll back the others — see
 * lib/kol.ts#recalculateAllKOL for the same allSettled-by-hand shape.
 */
export async function backfillAllLoanSchedules(tenantId?: string): Promise<{ processed: number; skipped: number; failed: number }> {
  const where = { installments: { none: {} }, ...(tenantId ? { tenantId } : {}) };
  const loans = tenantId
    ? await db.loan.findMany({ where, select: { id: true } })
    : await withoutTenantScope(() => db.loan.findMany({ where, select: { id: true } }));

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const { id } of loans) {
    try {
      const result = await db.$transaction((tx) => backfillLoan(tx, id));
      if (result) processed += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }

  return { processed, skipped, failed };
}
