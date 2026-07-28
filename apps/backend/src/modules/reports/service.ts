import { endOfMonth, startOfMonth, startOfYear, endOfYear } from "date-fns";
import { db } from "../../lib/db.js";

export interface ReportParams {
  startDate?: Date;
  endDate?: Date;
}

/** RPT-01 — hand-aggregated savings/loan summary for an arbitrary date range. */
export async function getFinancialReport(tenantId: string, params: ReportParams) {
  const start = params.startDate ?? startOfMonth(new Date());
  const end = params.endDate ?? endOfMonth(new Date());

  const [savingsByType, depositTotal, withdrawalTotal, loansDisbursed, paymentsReceived, savingBalance, loanOutstanding] =
    await Promise.all([
      db.savingConfig.findMany({
        where: { tenantId },
        include: { savings: { where: { tenantId, isActive: true }, select: { balance: true } } }
      }),
      db.savingTransaction.aggregate({
        where: { tenantId, type: "DEPOSIT", createdAt: { gte: start, lte: end } },
        _sum: { amount: true },
        _count: true
      }),
      db.savingTransaction.aggregate({
        where: { tenantId, type: "WITHDRAWAL", createdAt: { gte: start, lte: end } },
        _sum: { amount: true },
        _count: true
      }),
      db.loan.aggregate({
        where: { tenantId, disbursedAt: { gte: start, lte: end } },
        _sum: { principalAmount: true },
        _count: true
      }),
      db.loanPayment.aggregate({
        where: { tenantId, paidAt: { gte: start, lte: end } },
        _sum: { amount: true, penalty: true },
        _count: true
      }),
      db.saving.aggregate({ where: { tenantId, isActive: true }, _sum: { balance: true } }),
      db.loan.aggregate({ where: { tenantId, status: "ACTIVE" }, _sum: { remainingAmount: true } })
    ]);

  const simpananPerJenis = savingsByType.map((config) => ({
    name: config.name,
    type: config.type,
    totalBalance: config.savings.reduce((sum, s) => sum + Number(s.balance), 0).toString(),
    count: config.savings.length
  }));

  return {
    periode: { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] },
    simpananPerJenis,
    transaksiSimpanan: {
      deposit: { total: (depositTotal._sum.amount ?? 0).toString(), count: depositTotal._count },
      withdrawal: { total: (withdrawalTotal._sum.amount ?? 0).toString(), count: withdrawalTotal._count }
    },
    pinjaman: {
      dicairkan: { total: (loansDisbursed._sum.principalAmount ?? 0).toString(), count: loansDisbursed._count },
      angsuranDiterima: {
        total: (paymentsReceived._sum.amount ?? 0).toString(),
        totalDenda: (paymentsReceived._sum.penalty ?? 0).toString(),
        count: paymentsReceived._count
      }
    },
    saldoAkhirSimpanan: (savingBalance._sum.balance ?? 0).toString(),
    sisaPinjamanOutstanding: (loanOutstanding._sum.remainingAmount ?? 0).toString()
  };
}

/** RPT-02 — Rapat Anggota Tahunan (RAT) summary for a calendar year. */
export async function getRATReport(tenantId: string, year: number) {
  const yearStart = startOfYear(new Date(year, 0, 1));
  const yearEnd = endOfYear(new Date(year, 11, 31));

  const [membersStart, membersEnd, savingGrowth, loansGiven, loansCompleted, kolDist] = await Promise.all([
    db.member.count({ where: { tenantId, createdAt: { lt: yearStart }, isActive: true } }),
    db.member.count({ where: { tenantId, isActive: true } }),
    db.savingConfig.findMany({
      where: { tenantId },
      include: { savings: { where: { tenantId, isActive: true }, select: { balance: true } } }
    }),
    db.loan.aggregate({
      where: { tenantId, disbursedAt: { gte: yearStart, lte: yearEnd } },
      _sum: { principalAmount: true },
      _count: true
    }),
    db.loan.count({ where: { tenantId, status: "COMPLETED", updatedAt: { gte: yearStart, lte: yearEnd } } }),
    db.loan.groupBy({ by: ["kolCategory"], where: { tenantId, status: "ACTIVE" }, _count: true })
  ]);

  const totalActiveLoans = kolDist.reduce((sum, k) => sum + k._count, 0);
  const kolDistribution = kolDist.map((k) => ({
    category: k.kolCategory,
    count: k._count,
    percentage: totalActiveLoans > 0 ? ((k._count / totalActiveLoans) * 100).toFixed(1) + "%" : "0%"
  }));

  return {
    tahun: year,
    keanggotaan: { awalTahun: membersStart, akhirTahun: membersEnd, pertumbuhan: membersEnd - membersStart },
    simpanan: savingGrowth.map((cfg) => ({
      jenis: cfg.name,
      type: cfg.type,
      totalSaldo: cfg.savings.reduce((sum, s) => sum + Number(s.balance), 0).toString(),
      jumlahRekening: cfg.savings.length
    })),
    pinjaman: {
      diberikan: { total: (loansGiven._sum.principalAmount ?? 0).toString(), count: loansGiven._count },
      lunas: loansCompleted
    },
    kolDistribution
  };
}
