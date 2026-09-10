import { endOfMonth, startOfMonth } from "date-fns";
import { db } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import {
  getMemberInterestPaidInPeriod,
  getShuDistribution,
  memberSavingsBreakdownAsOf
} from "../reports/regulatory-service.js";

export interface UnitAssetTotal {
  unitId: string;
  unitName: string;
  assets: number;
}

export interface ConsolidatedAssets {
  totalAssets: number;
  byUnit: UnitAssetTotal[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sums ASET-category JournalLines whose parent JournalEntry.sourceId is one
 * of `sourceIds`, honoring each account's normalBalance the same way
 * modules/reports/regulatory-service.ts#getNeraca does (DEBIT-normal:
 * debit-credit; KREDIT-normal: credit-debit) — ASET accounts are normally
 * DEBIT, but this stays correct even for an unusual COA setup.
 */
async function sumAssetLinesForSourceIds(tenantId: string, sourceIds: string[]): Promise<number> {
  if (sourceIds.length === 0) return 0;

  const lines = await db.journalLine.findMany({
    where: {
      tenantId,
      account: { category: "ASET" },
      journalEntry: { tenantId, sourceId: { in: sourceIds } }
    },
    select: { debit: true, credit: true, account: { select: { normalBalance: true } } }
  });

  return round2(
    lines.reduce((sum, line) => {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const net = line.account.normalBalance === "DEBIT" ? debit - credit : credit - debit;
      return sum + net;
    }, 0)
  );
}

/**
 * Read-only KSU consolidation: total ASET-category balance per active
 * CooperativeUnit, plus a tenant-wide sum, derived entirely from existing
 * JournalEntry/JournalLine rows — nothing is written here (see lib/journal.ts
 * for the only posting path, which this module never calls).
 *
 * JournalEntry carries no unitId column of its own, so a line is attributed
 * to a unit by tracing its parent entry's `sourceId` back to the row that
 * triggered it. That tracing is exact for a LOAN_DISBURSEMENT entry, whose
 * `sourceId` is the Loan's own id (lib/journal.ts#postLoanDisbursement) — so
 * a unit's Loan ids match directly. It is a deliberate no-op for Saving ids:
 * a SAVING_TRANSACTION entry's `sourceId` is the *SavingTransaction* id, and
 * a LOAN_PAYMENT entry's `sourceId` is the *LoanPayment* id — both child rows,
 * never the Saving/Loan id itself — so neither ever matches a Saving/Loan id
 * and this MVP does not attribute savings deposits/withdrawals or loan
 * repayments to a unit. Extending that (resolving each unit's child
 * transaction ids too) is future work, not this spike's scope.
 */
export async function getConsolidatedAssets(tenantId: string): Promise<ConsolidatedAssets> {
  const units = await db.cooperativeUnit.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: "asc" }
  });

  const byUnit = await Promise.all(
    units.map(async (unit) => {
      const [loans, savings] = await Promise.all([
        db.loan.findMany({ where: { tenantId, unitId: unit.id }, select: { id: true } }),
        db.saving.findMany({ where: { tenantId, unitId: unit.id }, select: { id: true } })
      ]);
      const sourceIds = [...loans.map((l) => l.id), ...savings.map((s) => s.id)];
      const assets = await sumAssetLinesForSourceIds(tenantId, sourceIds);
      return { unitId: unit.id, unitName: unit.name, assets };
    })
  );

  const totalAssets = round2(byUnit.reduce((sum, u) => sum + u.assets, 0));
  return { totalAssets, byUnit };
}

// ── Day 4: per-member per-unit SHU statement ─────────────────────────────────

export interface MemberUnitShu {
  unitId: string;
  unitName: string;
  shu: number;
}

export interface MemberUnitStatement {
  memberId: string;
  units: MemberUnitShu[];
}

/**
 * Default reporting window when the caller doesn't pin one: the current
 * calendar month, the same "no query param given" default `resolvePeriod()`
 * uses for every other regulatory report (modules/reports/routes.ts) — this
 * function's caller has no route yet, so there's no query string to read.
 */
function defaultShuPeriod(): { from: Date; to: Date } {
  const now = new Date();
  return { from: startOfMonth(now), to: endOfMonth(now) };
}

/**
 * Per-CooperativeUnit breakdown of one member's SHU (Sisa Hasil Usaha), for a
 * KSU tenant where a member's Savings/Loan activity can span more than one
 * unit. This reuses getShuDistribution's exact formula and configured rates
 * (modules/reports/regulatory-service.ts) rather than inventing a new one:
 * that function already computes each member's real jasaSimpanan (their
 * share of the savings-interest pool, proportional to average savings
 * balance) and jasaPinjaman (their share of the loan-interest pool,
 * proportional to interest paid) — tenant-wide, every unit combined.
 *
 * To attribute a *slice* of that same total to one unit, this recomputes
 * only the member's own numerator — avgSavingsBalance / interestPaid —
 * restricted to that unit's Saving/LoanPayment rows (via the `unitId`
 * parameter added to memberSavingsBreakdownAsOf and the new
 * getMemberInterestPaidInPeriod, both in regulatory-service.ts), while
 * reusing the exact same tenant-wide denominators and pool totals
 * getShuDistribution itself used. So summing a member's per-unit `shu`
 * across every unit they're active in reproduces getShuDistribution's own
 * totalShu for that member (up to rounding) — nothing here changes the
 * formula, only which rows feed it.
 *
 * A member with no config set, or a non-positive shuBerjalan for the period
 * (both cases where getShuDistribution itself reports no distributable
 * SHU), gets `shu: 0` for every unit they're active in rather than an empty
 * list — they DO have unit activity, there's just nothing to distribute yet.
 * Same for an inactive member: getShuDistribution only shares SHU among
 * currently-active members, so an inactive member is given 0 rather than a
 * share of a pool they're not actually part of.
 *
 * KNOWN LIMITATION (matches modules/savings/service.ts#createSaving): every
 * Saving is created against the tenant's sole *default* unit — there is no
 * unit-picker for savings yet (only Loans accept an explicit `unitId`, see
 * lib/units.ts#resolveUnitId) — so today a member's jasaSimpanan share always
 * lands entirely on their default unit; only jasaPinjaman can actually split
 * across more than one unit.
 */
export async function getMemberUnitStatement(
  tenantId: string,
  memberId: string,
  period: { from: Date; to: Date } = defaultShuPeriod()
): Promise<MemberUnitStatement> {
  const member = await db.member.findFirst({ where: { id: memberId, tenantId } });
  if (!member) throw notFound("Anggota tidak ditemukan");

  const [loanUnitRows, savingUnitRows] = await Promise.all([
    db.loan.findMany({ where: { tenantId, memberId }, select: { unitId: true } }),
    db.saving.findMany({ where: { tenantId, memberId }, select: { unitId: true } })
  ]);
  const unitIds = Array.from(new Set([...loanUnitRows.map((l) => l.unitId), ...savingUnitRows.map((s) => s.unitId)]));
  const units = await db.cooperativeUnit.findMany({
    where: { tenantId, id: { in: unitIds } },
    orderBy: { createdAt: "asc" }
  });

  if (!member.isActive || units.length === 0) {
    return { memberId, units: units.map((u) => ({ unitId: u.id, unitName: u.name, shu: 0 })) };
  }

  const { from, to } = period;
  const distribution = await getShuDistribution(tenantId, from, to);

  if (!distribution.alokasi || distribution.anggota.length === 0) {
    return { memberId, units: units.map((u) => ({ unitId: u.id, unitName: u.name, shu: 0 })) };
  }

  const totalAvgSavings = round2(distribution.anggota.reduce((sum, a) => sum + Number(a.avgSavingsBalance), 0));
  const totalInterestPaid = round2(distribution.anggota.reduce((sum, a) => sum + Number(a.interestPaid), 0));
  const jasaSimpananTotal = Number(distribution.alokasi.jasaSimpanan.total);
  const jasaPinjamanTotal = Number(distribution.alokasi.jasaPinjaman.total);

  const unitStatements = await Promise.all(
    units.map(async (unit) => {
      const [breakdownAtFrom, breakdownAtTo, unitInterestPaid] = await Promise.all([
        memberSavingsBreakdownAsOf(tenantId, memberId, from, unit.id),
        memberSavingsBreakdownAsOf(tenantId, memberId, to, unit.id),
        getMemberInterestPaidInPeriod(tenantId, memberId, from, to, unit.id)
      ]);

      const unitAvgSavings = round2((breakdownAtFrom.total + breakdownAtTo.total) / 2);
      const jasaSimpanan = totalAvgSavings > 0 ? round2((unitAvgSavings / totalAvgSavings) * jasaSimpananTotal) : 0;
      const jasaPinjaman =
        totalInterestPaid > 0 ? round2((unitInterestPaid / totalInterestPaid) * jasaPinjamanTotal) : 0;

      return { unitId: unit.id, unitName: unit.name, shu: round2(jasaSimpanan + jasaPinjaman) };
    })
  );

  return { memberId, units: unitStatements };
}

// ── Day 4: unit loan-volume segregation threshold ────────────────────────────

/**
 * Hardcoded MVP threshold — no regulatory source cited in the spike plan,
 * just a round number to prototype the "approaching a lending-concentration
 * limit" UX for a KSP unit.
 */
export const SEGREGATION_THRESHOLD_RP = 5_000_000_000;

/**
 * >=90% of the threshold counts as "approaching" — a conventional
 * early-warning band, chosen because the spike plan didn't specify one.
 */
const APPROACHING_THRESHOLD_RATIO = 0.9;

export interface UnitSegregationStatus {
  unitId: string;
  currentVolumeRp: number;
  thresholdRp: number;
  status: "OK" | "APPROACHING_THRESHOLD" | "EXCEEDED" | "NOT_APPLICABLE";
}

/**
 * Flags a KSP unit whose current loan volume is nearing the hardcoded Rp 5B
 * lending-concentration threshold.
 *
 * "Current volume" sums `principalAmount` over that unit's ACTIVE loans
 * only — a COMPLETED loan no longer carries outstanding risk, and
 * PENDING/DEFAULTED loans are excluded too. This is a deliberate choice to
 * track *current standing exposure*, not lifetime disbursement volume; the
 * plan didn't specify which loans to include, and the alternative (summing
 * every loan ever disbursed regardless of status) would never go back down
 * as a unit's borrowers repay, which defeats the point of a segregation
 * check.
 *
 * Only meaningful for a KSP unit — a Toko/Konsumen unit doesn't lend — so a
 * non-KSP unit short-circuits to NOT_APPLICABLE (currentVolumeRp reported as
 * 0, its loan volume deliberately not computed) rather than throwing; this
 * lets a caller loop over every unit in a tenant without pre-filtering by
 * type first.
 */
export async function checkUnitSegregation(tenantId: string, unitId: string): Promise<UnitSegregationStatus> {
  const unit = await db.cooperativeUnit.findFirst({ where: { id: unitId, tenantId } });
  if (!unit) throw notFound("Unit tidak ditemukan");

  if (unit.type !== "KSP") {
    return { unitId: unit.id, currentVolumeRp: 0, thresholdRp: SEGREGATION_THRESHOLD_RP, status: "NOT_APPLICABLE" };
  }

  const activeLoans = await db.loan.findMany({
    where: { tenantId, unitId: unit.id, status: "ACTIVE" },
    select: { principalAmount: true }
  });
  const currentVolumeRp = round2(activeLoans.reduce((sum, l) => sum + Number(l.principalAmount), 0));

  const status: UnitSegregationStatus["status"] =
    currentVolumeRp >= SEGREGATION_THRESHOLD_RP
      ? "EXCEEDED"
      : currentVolumeRp >= SEGREGATION_THRESHOLD_RP * APPROACHING_THRESHOLD_RATIO
        ? "APPROACHING_THRESHOLD"
        : "OK";

  return { unitId: unit.id, currentVolumeRp, thresholdRp: SEGREGATION_THRESHOLD_RP, status };
}
