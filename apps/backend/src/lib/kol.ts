import { differenceInDays } from "date-fns";
import type { KOLCategory } from "@siskop/types";
import { db } from "./db.js";
import { withoutTenantScope } from "./tenant-scope.js";

export function getKOLCategory(daysOverdue: number): KOLCategory {
  if (daysOverdue <= 30) return "LANCAR";
  if (daysOverdue <= 90) return "DALAM_PERHATIAN";
  if (daysOverdue <= 120) return "KURANG_LANCAR";
  if (daysOverdue <= 180) return "DIRAGUKAN";
  return "MACET";
}

/**
 * Days overdue: with a schedule (LoanInstallment — koperasi pasar plan F2),
 * the oldest UNPAID/PARTIAL installment whose dueDate has passed sets it,
 * exactly, instead of the legacy month-matching guess below. `getKOLCategory`
 * itself is unchanged (D2). `installments` is [] for a loan created before
 * F2's migration until it's backfilled, which falls through to the legacy
 * path — ordered oldest-first (by seq) either way, so `.find` picks the
 * oldest.
 */
function daysOverdueFromSchedule(
  installments: { seq: number; dueDate: Date; status: string }[],
  today: Date
): number {
  const oldestUnpaid = installments.find((i) => i.status !== "PAID");
  if (!oldestUnpaid || oldestUnpaid.dueDate > today) return 0;
  return differenceInDays(today, oldestUnpaid.dueDate);
}

/**
 * No per-installment amortization schedule exists for a pre-F2 loan
 * (loan-calc.ts only computes a flat monthlyPayment at creation), so overdue
 * installments are inferred: walk each expected due month since
 * disbursement, and for any month with no matching payment (matched by
 * year+month of `payment.dueDate`), track the largest days-overdue seen.
 * Ported as-is from the pre-rescaffold system.
 */
function legacyDaysOverdue(loan: { termMonths: number; disbursedAt: Date | null; createdAt: Date }, payments: { dueDate: Date | null }[], today: Date): number {
  const disbursed = loan.disbursedAt ?? loan.createdAt;
  let maxDaysOverdue = 0;

  for (let i = 1; i <= loan.termMonths; i++) {
    const dueDate = new Date(disbursed);
    dueDate.setMonth(dueDate.getMonth() + i);

    if (dueDate > today) break;

    const payment = payments.find(
      (p) => p.dueDate && p.dueDate.getFullYear() === dueDate.getFullYear() && p.dueDate.getMonth() === dueDate.getMonth()
    );

    if (!payment) {
      const days = differenceInDays(today, dueDate);
      maxDaysOverdue = Math.max(maxDaysOverdue, days);
    }
  }

  return maxDaysOverdue;
}

export async function recalculateKOL(loanId: string): Promise<KOLCategory> {
  const loan = await db.loan.findUnique({
    where: { id: loanId },
    include: {
      payments: { orderBy: { dueDate: "asc" } },
      installments: { orderBy: { seq: "asc" } }
    }
  });

  if (!loan || loan.status !== "ACTIVE") return "LANCAR";

  const today = new Date();
  const maxDaysOverdue =
    loan.installments.length > 0
      ? daysOverdueFromSchedule(loan.installments, today)
      : legacyDaysOverdue(loan, loan.payments, today);

  const newCategory = getKOLCategory(maxDaysOverdue);

  await db.loan.update({
    where: { id: loanId, tenantId: loan.tenantId },
    data: { kolCategory: newCategory, daysOverdue: maxDaysOverdue }
  });

  return newCategory;
}

/**
 * Omitting `tenantId` sweeps every tenant's active loans — the scheduler's
 * daily use — which needs `withoutTenantScope` to pass lib/tenant-scope.ts's
 * guard (that findMany would otherwise have no tenantId filter at all). The
 * tenantId-provided path leaves the guard on, same as every other caller.
 */
export async function recalculateAllKOL(tenantId?: string): Promise<{ checked: number; failed: number }> {
  const where = { status: "ACTIVE" as const, ...(tenantId ? { tenantId } : {}) };
  const loans = tenantId
    ? await db.loan.findMany({ where, select: { id: true } })
    : await withoutTenantScope(() => db.loan.findMany({ where, select: { id: true } }));

  const results = await Promise.allSettled(loans.map((l) => recalculateKOL(l.id)));
  const failed = results.filter((r) => r.status === "rejected").length;
  return { checked: loans.length, failed };
}
