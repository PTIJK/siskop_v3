import { differenceInDays } from "date-fns";
import type { KOLCategory } from "@siskop/types";
import { db } from "./db.js";

export function getKOLCategory(daysOverdue: number): KOLCategory {
  if (daysOverdue <= 30) return "LANCAR";
  if (daysOverdue <= 90) return "DALAM_PERHATIAN";
  if (daysOverdue <= 120) return "KURANG_LANCAR";
  if (daysOverdue <= 180) return "DIRAGUKAN";
  return "MACET";
}

/**
 * No per-installment amortization schedule exists (loan-calc.ts only computes
 * a flat monthlyPayment at creation), so overdue installments are inferred:
 * walk each expected due month since disbursement, and for any month with no
 * matching payment (matched by year+month of `payment.dueDate`), track the
 * largest days-overdue seen. Ported as-is from the pre-rescaffold system.
 */
export async function recalculateKOL(loanId: string): Promise<KOLCategory> {
  const loan = await db.loan.findUnique({
    where: { id: loanId },
    include: { payments: { orderBy: { dueDate: "asc" } } }
  });

  if (!loan || loan.status !== "ACTIVE") return "LANCAR";

  const today = new Date();
  const payments = loan.payments;
  const disbursed = loan.disbursedAt ?? loan.createdAt;
  let maxDaysOverdue = 0;

  for (let i = 1; i <= loan.termMonths; i++) {
    const dueDate = new Date(disbursed);
    dueDate.setMonth(dueDate.getMonth() + i);

    if (dueDate > today) break;

    const payment = payments.find(
      (p) => p.dueDate.getFullYear() === dueDate.getFullYear() && p.dueDate.getMonth() === dueDate.getMonth()
    );

    if (!payment) {
      const days = differenceInDays(today, dueDate);
      maxDaysOverdue = Math.max(maxDaysOverdue, days);
    }
  }

  const newCategory = getKOLCategory(maxDaysOverdue);

  await db.loan.update({
    where: { id: loanId },
    data: { kolCategory: newCategory, daysOverdue: maxDaysOverdue }
  });

  return newCategory;
}

export async function recalculateAllKOL(tenantId?: string): Promise<void> {
  const loans = await db.loan.findMany({
    where: { status: "ACTIVE", ...(tenantId ? { tenantId } : {}) },
    select: { id: true }
  });

  await Promise.allSettled(loans.map((l) => recalculateKOL(l.id)));
}
