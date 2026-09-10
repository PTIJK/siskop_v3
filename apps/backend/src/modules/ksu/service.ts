import { db } from "../../lib/db.js";

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
