import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import prisma from '../../lib/prisma';

export class DashboardService {
  async getSummary(tenantId: string) {
    const [totalSavings, totalActiveLoans, memberCount, monthlyPayments, overdueCount] =
      await Promise.all([
        prisma.saving.aggregate({
          where: { tenantId, isActive: true },
          _sum: { balance: true },
        }),
        prisma.loan.aggregate({
          where: { tenantId, status: 'ACTIVE' },
          _sum: { remainingAmount: true },
        }),
        prisma.member.count({ where: { tenantId, isActive: true } }),
        prisma.loanPayment.aggregate({
          where: {
            tenantId,
            paidAt: {
              gte: startOfMonth(new Date()),
              lte: endOfMonth(new Date()),
            },
          },
          _sum: { amount: true },
        }),
        prisma.loan.count({
          where: { tenantId, status: 'ACTIVE', kolCategory: 'MACET' },
        }),
      ]);

    return {
      totalSavings: (totalSavings._sum.balance ?? 0).toString(),
      totalActiveLoans: (totalActiveLoans._sum.remainingAmount ?? 0).toString(),
      memberCount,
      monthlyPayments: (monthlyPayments._sum.amount ?? 0).toString(),
      overdueCount,
    };
  }

  async getLoanChart(tenantId: string, months: number) {
    const result: { month: string; value: string }[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const date = subMonths(now, i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);

      const agg = await prisma.loan.aggregate({
        where: {
          tenantId,
          disbursedAt: { gte: start, lte: end },
        },
        _sum: { principalAmount: true },
      });

      result.push({
        month: format(date, 'MMM yyyy'),
        value: (agg._sum.principalAmount ?? 0).toString(),
      });
    }

    return result;
  }

  async getPaymentChart(tenantId: string, months: number) {
    const result: { month: string; value: string }[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const date = subMonths(now, i);
      const start = startOfMonth(date);
      const end = endOfMonth(date);

      const agg = await prisma.loanPayment.aggregate({
        where: {
          tenantId,
          paidAt: { gte: start, lte: end },
        },
        _sum: { amount: true },
      });

      result.push({
        month: format(date, 'MMM yyyy'),
        value: (agg._sum.amount ?? 0).toString(),
      });
    }

    return result;
  }
}

export const dashboardService = new DashboardService();
