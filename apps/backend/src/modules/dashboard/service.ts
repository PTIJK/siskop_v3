import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import type { ChartPoint, DashboardSummary } from "@siskop/types";
import { db } from "../../lib/db.js";

export async function getDashboardSummary(tenantId: string): Promise<DashboardSummary> {
  const [totalSavings, totalActiveLoans, memberCount, monthlyPayments, overdueCount] = await Promise.all([
    db.saving.aggregate({ where: { tenantId, isActive: true }, _sum: { balance: true } }),
    db.loan.aggregate({ where: { tenantId, status: "ACTIVE" }, _sum: { remainingAmount: true } }),
    db.member.count({ where: { tenantId, isActive: true } }),
    db.loanPayment.aggregate({
      where: { tenantId, paidAt: { gte: startOfMonth(new Date()), lte: endOfMonth(new Date()) } },
      _sum: { amount: true }
    }),
    // Only the worst KOL bucket (MACET), not every non-LANCAR loan — matches
    // the pre-rescaffold system exactly (loans.getOverdue casts a wider net).
    db.loan.count({ where: { tenantId, status: "ACTIVE", kolCategory: "MACET" } })
  ]);

  return {
    totalSavings: (totalSavings._sum.balance ?? 0).toString(),
    totalActiveLoans: (totalActiveLoans._sum.remainingAmount ?? 0).toString(),
    memberCount,
    monthlyPayments: (monthlyPayments._sum.amount ?? 0).toString(),
    overdueCount
  };
}

export async function getLoanChart(tenantId: string, months: number): Promise<ChartPoint[]> {
  const result: ChartPoint[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const date = subMonths(now, i);
    const start = startOfMonth(date);
    const end = endOfMonth(date);

    const agg = await db.loan.aggregate({
      where: { tenantId, disbursedAt: { gte: start, lte: end } },
      _sum: { principalAmount: true }
    });

    result.push({ month: format(date, "MMM yyyy"), value: (agg._sum.principalAmount ?? 0).toString() });
  }

  return result;
}

export async function getPaymentChart(tenantId: string, months: number): Promise<ChartPoint[]> {
  const result: ChartPoint[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const date = subMonths(now, i);
    const start = startOfMonth(date);
    const end = endOfMonth(date);

    const agg = await db.loanPayment.aggregate({
      where: { tenantId, paidAt: { gte: start, lte: end } },
      _sum: { amount: true }
    });

    result.push({ month: format(date, "MMM yyyy"), value: (agg._sum.amount ?? 0).toString() });
  }

  return result;
}
