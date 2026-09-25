import type { EquityClass } from "./accounting.js";

export interface DashboardSummary {
  totalSavings: string;
  /** Simpanan pokok + wajib — equity (Modal Sendiri), not money owed to members. */
  savingsEquity: string;
  /** Every other savings product (sukarela, berjangka) — a liability to members. */
  savingsLiability: string;
  totalActiveLoans: string;
  memberCount: number;
  monthlyPayments: string;
  /** Count of ACTIVE loans in the worst KOL bucket (MACET) only. */
  overdueCount: number;
  /**
   * The same figures one month back, where they can be rebuilt from history:
   * active members who joined before this month, and last month's repayments.
   */
  previous: { memberCount: number; monthlyPayments: string };
}

export interface ChartQuery {
  months?: number;
}

export interface ChartPoint {
  month: string;
  value: string;
}

/** Every dashboard endpoint accepts it; omitted = consolidated (CLAUDE.md rule 2b). */
export interface DashboardUnitQuery {
  unitId?: string;
}

export type KspClass = "KSP_I" | "KSP_II" | "KSP_III" | "KSP_IV";

export interface BmppBorrower {
  memberId: string;
  memberName: string;
  isRelatedParty: boolean;
  /** Principal of the member's ACTIVE loans. */
  principal: string;
  /** 10 for pengurus/pengawas (Pasal 44), 15 otherwise (Pasal 45). */
  limitPct: number;
  limit: string;
  /** principal / limit × 100, 2 decimals; null when the limit is 0. */
  usagePct: string | null;
}

/** Permodalan health (Permenkop UKM 8/2023, 2/2024). Money as Decimal strings, ratios as percent strings. */
export interface CapitalDashboard {
  modalSendiri: string;
  /** Ledger amount per Modal Sendiri class with a balance, lampiran order. */
  komposisi: { equityClass: EquityClass; amount: string }[];
  penyesuaianSaldoAwal: string;
  /** Modal Sendiri at each of the last 12 month ends, oldest first (the last point is today). */
  trend: ChartPoint[];
  totalAset: string;
  /** Modal Sendiri / total aset × 100; null without assets. Benchmark: ≥ 10%. */
  rasioModalSendiriAset: string | null;
  audit: {
    threshold: string;
    progressPct: string;
    reached: boolean;
    /** Pasal 12(1) only binds koperasi with an active KSP unit. */
    applies: boolean;
  };
  klasifikasi: KspClass;
  bmpp: { topBorrowers: BmppBorrower[] };
  /** Members whose pokok + wajib exceed 20% of Modal Sendiri (Pasal 63(6)), largest first. */
  konsentrasiSimpanan: { memberId: string; memberName: string; amount: string; pctOfModalSendiri: string }[];
}

export interface LoanQualityDashboard {
  /** Remaining amount of ACTIVE loans. */
  totalOutstanding: string;
  byKol: { category: "LANCAR" | "DALAM_PERHATIAN" | "KURANG_LANCAR" | "DIRAGUKAN" | "MACET"; count: number; outstanding: string }[];
  /** (kurang lancar + diragukan + macet) / outstanding × 100; null with nothing outstanding. */
  nplRatio: string | null;
  /** Outstanding / savings that are a liability × 100; null without such savings. */
  ldr: string | null;
  /** The five largest non-LANCAR loans. */
  topOverdue: { loanId: string; memberName: string; kolCategory: string; outstanding: string }[];
}

export interface GrowthPoint {
  month: string;
  newMembers: number;
  /** Deposits (incl. credited interest) minus withdrawals. */
  savingsNetFlow: string;
  disbursement: string;
  repayment: string;
}
