import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { Prisma } from "@prisma/client";
import type {
  BmppBorrower,
  CapitalDashboard,
  ChartPoint,
  DashboardSummary,
  GrowthPoint,
  LoanQualityDashboard
} from "@siskop/types";
import { db } from "../../lib/db.js";
import { MODAL_DISETOR_AUDIT_THRESHOLD_RP, REGULATORY_CAPS, classifyKsp } from "../../lib/regulatory-config.js";
import { getModalSendiri, getTotalAset, komposisiModalSendiri } from "../reports/capital-service.js";

const ZERO = new Prisma.Decimal(0);
const EQUITY_SAVING_TYPES = ["POKOK", "WAJIB"] as const;
const KOL_ORDER = ["LANCAR", "DALAM_PERHATIAN", "KURANG_LANCAR", "DIRAGUKAN", "MACET"] as const;
const NPL_KOL = new Set<string>(["KURANG_LANCAR", "DIRAGUKAN", "MACET"]);
/** Pasal 63(6): one member's pokok + wajib may be at most 20% of Modal Sendiri. */
const MEMBER_CAPITAL_CONCENTRATION_PCT = 20;
const TOP_N = 5;

/** part / whole × 100 to 2 decimals, or null when whole is 0. */
function pct(part: Prisma.Decimal, whole: Prisma.Decimal): string | null {
  return whole.isZero() ? null : part.div(whole).mul(100).toFixed(2);
}

/**
 * `unitId` narrows every figure to one unit (members through their unit
 * membership, payments and savings transactions through their loan/saving);
 * omitted = consolidated (CLAUDE.md rule 2b). The route resolves and
 * access-checks it before it gets here.
 */
function scope(unitId?: string) {
  return {
    saving: unitId ? { unitId } : {},
    loan: unitId ? { unitId } : {},
    member: unitId ? { memberships: { some: { unitId } } } : {}
  };
}

export async function getDashboardSummary(tenantId: string, unitId?: string): Promise<DashboardSummary> {
  const s = scope(unitId);
  const now = new Date();
  const lastMonth = subMonths(now, 1);
  const [totalSavings, savingsEquity, totalActiveLoans, memberCount, monthlyPayments, overdueCount, previousMembers, lastMonthPayments] =
    await Promise.all([
      db.saving.aggregate({ where: { tenantId, isActive: true, ...s.saving }, _sum: { balance: true } }),
      db.saving.aggregate({
        where: { tenantId, isActive: true, ...s.saving, savingConfig: { type: { in: [...EQUITY_SAVING_TYPES] } } },
        _sum: { balance: true }
      }),
      db.loan.aggregate({ where: { tenantId, status: "ACTIVE", ...s.loan }, _sum: { remainingAmount: true } }),
      db.member.count({ where: { tenantId, isActive: true, ...s.member } }),
      db.loanPayment.aggregate({
        where: { tenantId, paidAt: { gte: startOfMonth(now), lte: endOfMonth(now) }, ...(unitId ? { loan: { unitId } } : {}) },
        _sum: { amount: true }
      }),
      // Only the worst KOL bucket (MACET), not every non-LANCAR loan — matches
      // the pre-rescaffold system exactly (loans.getOverdue casts a wider net).
      db.loan.count({ where: { tenantId, status: "ACTIVE", kolCategory: "MACET", ...s.loan } }),
      // Rebuilt from createdAt: members who have left since aren't known, so this
      // counts today's active members who had already joined a month ago.
      db.member.count({ where: { tenantId, isActive: true, createdAt: { lt: startOfMonth(now) }, ...s.member } }),
      db.loanPayment.aggregate({
        where: {
          tenantId,
          paidAt: { gte: startOfMonth(lastMonth), lte: endOfMonth(lastMonth) },
          ...(unitId ? { loan: { unitId } } : {})
        },
        _sum: { amount: true }
      })
    ]);

  const total = totalSavings._sum.balance ?? ZERO;
  const equity = savingsEquity._sum.balance ?? ZERO;
  return {
    totalSavings: total.toString(),
    savingsEquity: equity.toString(),
    savingsLiability: total.sub(equity).toString(),
    totalActiveLoans: (totalActiveLoans._sum.remainingAmount ?? 0).toString(),
    memberCount,
    monthlyPayments: (monthlyPayments._sum.amount ?? 0).toString(),
    overdueCount,
    previous: { memberCount: previousMembers, monthlyPayments: (lastMonthPayments._sum.amount ?? 0).toString() }
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

// ── Permodalan (Permenkop UKM 8/2023, 2/2024) ────────────────────────────────

export async function getCapitalDashboard(tenantId: string, unitId?: string): Promise<CapitalDashboard> {
  const s = scope(unitId);
  const now = new Date();
  const monthEnds = [...Array.from({ length: 11 }, (_, i) => endOfMonth(subMonths(now, 11 - i))), now];

  const [modalSendiri, totalAset, memberCount, hasKspUnit, trend, loanGroups, capitalGroups] = await Promise.all([
    getModalSendiri(tenantId, now, unitId),
    getTotalAset(tenantId, now, unitId),
    db.member.count({ where: { tenantId, isActive: true, ...s.member } }),
    db.cooperativeUnit.count({ where: { tenantId, type: "KSP", isActive: true } }),
    Promise.all(monthEnds.map((d) => getModalSendiri(tenantId, d, unitId))),
    db.loan.groupBy({
      by: ["memberId"],
      where: { tenantId, status: "ACTIVE", ...s.loan },
      _sum: { principalAmount: true }
    }),
    db.saving.groupBy({
      by: ["memberId"],
      where: { tenantId, isActive: true, ...s.saving, savingConfig: { type: { in: [...EQUITY_SAVING_TYPES] } } },
      _sum: { balance: true }
    })
  ]);
  const ms = modalSendiri.total;

  const members = await db.member.findMany({
    where: { tenantId, id: { in: [...new Set([...loanGroups, ...capitalGroups].map((g) => g.memberId))] } },
    select: { id: true, fullName: true, isPengurus: true, isPengawas: true }
  });
  const memberById = new Map(members.map((m) => [m.id, m]));

  const borrowers: BmppBorrower[] = loanGroups.map((g) => {
    const member = memberById.get(g.memberId);
    const isRelatedParty = Boolean(member?.isPengurus || member?.isPengawas);
    const limitPct = isRelatedParty
      ? REGULATORY_CAPS.RELATED_PARTY_LOAN_CONCENTRATION_PCT
      : REGULATORY_CAPS.NON_RELATED_PARTY_LOAN_CONCENTRATION_PCT;
    const principal = g._sum.principalAmount ?? ZERO;
    const limit = ms.mul(limitPct).div(100);
    return {
      memberId: g.memberId,
      memberName: member?.fullName ?? "-",
      isRelatedParty,
      principal: principal.toString(),
      limitPct,
      limit: limit.toString(),
      usagePct: pct(principal, limit)
    };
  });
  // Closest to its own limit first; without Modal Sendiri, simply the largest exposure.
  borrowers.sort((a, b) =>
    a.usagePct !== null && b.usagePct !== null
      ? Number(b.usagePct) - Number(a.usagePct)
      : new Prisma.Decimal(b.principal).cmp(a.principal)
  );

  const concentrationFloor = ms.mul(MEMBER_CAPITAL_CONCENTRATION_PCT).div(100);
  const konsentrasiSimpanan = ms.isZero()
    ? []
    : capitalGroups
        .map((g) => ({ memberId: g.memberId, amount: g._sum.balance ?? ZERO }))
        .filter((g) => g.amount.gt(concentrationFloor))
        .sort((a, b) => b.amount.cmp(a.amount))
        .map((g) => ({
          memberId: g.memberId,
          memberName: memberById.get(g.memberId)?.fullName ?? "-",
          amount: g.amount.toString(),
          pctOfModalSendiri: g.amount.div(ms).mul(100).toFixed(2)
        }));

  return {
    modalSendiri: ms.toString(),
    komposisi: komposisiModalSendiri(modalSendiri),
    penyesuaianSaldoAwal: modalSendiri.adjustment.toString(),
    trend: trend.map((m, i) => ({ month: format(monthEnds[i]!, "MMM yyyy"), value: m.total.toString() })),
    totalAset: totalAset.toString(),
    rasioModalSendiriAset: pct(ms, totalAset),
    audit: {
      threshold: MODAL_DISETOR_AUDIT_THRESHOLD_RP.toString(),
      progressPct: ms.div(MODAL_DISETOR_AUDIT_THRESHOLD_RP).mul(100).toFixed(2),
      reached: ms.gte(MODAL_DISETOR_AUDIT_THRESHOLD_RP),
      applies: hasKspUnit > 0
    },
    klasifikasi: classifyKsp({ members: memberCount, modalSendiri: ms, aset: totalAset }),
    bmpp: { topBorrowers: borrowers.slice(0, TOP_N) },
    konsentrasiSimpanan
  };
}

// ── Kualitas pinjaman ────────────────────────────────────────────────────────

export async function getLoanQualityDashboard(tenantId: string, unitId?: string): Promise<LoanQualityDashboard> {
  const s = scope(unitId);
  const [byKolRows, liability, topOverdue] = await Promise.all([
    db.loan.groupBy({
      by: ["kolCategory"],
      where: { tenantId, status: "ACTIVE", ...s.loan },
      _sum: { remainingAmount: true },
      _count: { _all: true }
    }),
    db.saving.aggregate({
      where: { tenantId, isActive: true, ...s.saving, savingConfig: { type: { notIn: [...EQUITY_SAVING_TYPES] } } },
      _sum: { balance: true }
    }),
    db.loan.findMany({
      where: { tenantId, status: "ACTIVE", kolCategory: { not: "LANCAR" }, ...s.loan },
      orderBy: { remainingAmount: "desc" },
      take: TOP_N,
      select: { id: true, kolCategory: true, remainingAmount: true, member: { select: { fullName: true } } }
    })
  ]);

  const rowByKol = new Map(byKolRows.map((r) => [r.kolCategory, r]));
  const byKol = KOL_ORDER.map((category) => {
    const row = rowByKol.get(category);
    return { category, count: row?._count._all ?? 0, outstanding: (row?._sum.remainingAmount ?? ZERO).toString() };
  });
  const totalOutstanding = byKol.reduce((sum, k) => sum.add(k.outstanding), ZERO);
  const npl = byKol.filter((k) => NPL_KOL.has(k.category)).reduce((sum, k) => sum.add(k.outstanding), ZERO);

  return {
    totalOutstanding: totalOutstanding.toString(),
    byKol,
    nplRatio: pct(npl, totalOutstanding),
    ldr: pct(totalOutstanding, liability._sum.balance ?? ZERO),
    topOverdue: topOverdue.map((l) => ({
      loanId: l.id,
      memberName: l.member.fullName,
      kolCategory: l.kolCategory,
      outstanding: l.remainingAmount.toString()
    }))
  };
}

// ── Pertumbuhan ──────────────────────────────────────────────────────────────

export async function getGrowthDashboard(tenantId: string, unitId?: string): Promise<GrowthPoint[]> {
  const s = scope(unitId);
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => subMonths(now, 11 - i));

  return Promise.all(
    months.map(async (date) => {
      const range = { gte: startOfMonth(date), lte: endOfMonth(date) };
      const [newMembers, flows, disbursement, repayment] = await Promise.all([
        db.member.count({ where: { tenantId, createdAt: range, ...s.member } }),
        db.savingTransaction.groupBy({
          by: ["type"],
          where: { tenantId, createdAt: range, ...(unitId ? { saving: { unitId } } : {}) },
          _sum: { amount: true }
        }),
        db.loan.aggregate({ where: { tenantId, disbursedAt: range, ...s.loan }, _sum: { principalAmount: true } }),
        db.loanPayment.aggregate({
          where: { tenantId, paidAt: range, ...(unitId ? { loan: { unitId } } : {}) },
          _sum: { amount: true }
        })
      ]);
      const netFlow = flows.reduce(
        (sum, f) => (f.type === "WITHDRAWAL" ? sum.sub(f._sum.amount ?? ZERO) : sum.add(f._sum.amount ?? ZERO)),
        ZERO
      );
      return {
        month: format(date, "MMM yyyy"),
        newMembers,
        savingsNetFlow: netFlow.toString(),
        disbursement: (disbursement._sum.principalAmount ?? ZERO).toString(),
        repayment: (repayment._sum.amount ?? ZERO).toString()
      };
    })
  );
}
