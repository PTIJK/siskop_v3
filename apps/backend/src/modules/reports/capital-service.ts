import { EquityClass, Prisma } from "@prisma/client";
import { db } from "../../lib/db.js";
import { MODAL_SENDIRI_CLASSES } from "../../lib/regulatory-config.js";

const ZERO = new Prisma.Decimal(0);

export interface ModalSendiri {
  /** gl + adjustment — the figure BMPP, the audit threshold and reports use. */
  total: Prisma.Decimal;
  /** Modal Sendiri journaled in the ledger up to asOf. */
  gl: Prisma.Decimal;
  /** Opening equity recorded outside the ledger (ModalSendiriAdjustment). */
  adjustment: Prisma.Decimal;
  /** Ledger figure per Modal Sendiri class; classes with no balance are 0. */
  byClass: Record<EquityClass, Prisma.Decimal>;
}

/**
 * Modal Sendiri (Permenkop UKM 8/2023 Pasal 1 angka 23-24) as of `asOf`: the
 * ledger balance of every EKUITAS account whose equityClass is in
 * MODAL_SENDIRI_CLASSES, plus the opening-balance adjustment. Decimal
 * throughout, so BMPP boundaries are exact to the sen.
 *
 * Without `unitId` it is the consolidated figure (every unit plus the
 * tenant-level unallocated bucket); with it, only that unit's journal entries
 * and adjustments — per-unit figures plus the unallocated bucket add back up
 * to the consolidated one (CLAUDE.md rule 2b).
 */
export async function getModalSendiri(tenantId: string, asOf: Date, unitId?: string): Promise<ModalSendiri> {
  const [gl, adjustment] = await Promise.all([ledgerModalSendiri(tenantId, asOf, unitId), adjustmentAsOf(tenantId, asOf, unitId)]);
  const total = gl.total.add(adjustment);
  return { total, gl: gl.total, adjustment, byClass: gl.byClass };
}

async function ledgerModalSendiri(tenantId: string, asOf: Date, unitId?: string) {
  const byClass = Object.fromEntries(Object.values(EquityClass).map((c) => [c, ZERO])) as Record<EquityClass, Prisma.Decimal>;

  const accounts = await db.account.findMany({
    where: { tenantId, category: "EKUITAS", equityClass: { in: [...MODAL_SENDIRI_CLASSES] } },
    select: { id: true, equityClass: true, normalBalance: true }
  });
  if (accounts.length === 0) return { total: ZERO, byClass };

  const sums = await db.journalLine.groupBy({
    by: ["accountId"],
    where: {
      tenantId,
      accountId: { in: accounts.map((a) => a.id) },
      journalEntry: { entryDate: { lte: asOf }, ...(unitId ? { unitId } : {}) }
    },
    _sum: { debit: true, credit: true }
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum]));

  let total = ZERO;
  for (const account of accounts) {
    const sum = sumByAccount.get(account.id);
    if (!sum || !account.equityClass) continue;
    const debit = sum.debit ?? ZERO;
    const credit = sum.credit ?? ZERO;
    const balance = account.normalBalance === "KREDIT" ? credit.sub(debit) : debit.sub(credit);
    byClass[account.equityClass] = byClass[account.equityClass].add(balance);
    total = total.add(balance);
  }
  return { total, byClass };
}

/**
 * The latest adjustment effective on or before `asOf` in each scope (a unit,
 * or null for the unallocated bucket), summed; same-day ties go to the most
 * recently recorded row.
 */
async function adjustmentAsOf(tenantId: string, asOf: Date, unitId?: string): Promise<Prisma.Decimal> {
  const rows = await db.modalSendiriAdjustment.findMany({
    where: { tenantId, effectiveDate: { lte: asOf }, ...(unitId ? { unitId } : {}) },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
    select: { unitId: true, amount: true }
  });

  const latestByScope = new Map<string | null, Prisma.Decimal>();
  for (const row of rows) {
    if (!latestByScope.has(row.unitId)) latestByScope.set(row.unitId, row.amount);
  }
  return [...latestByScope.values()].reduce((sum, amount) => sum.add(amount), ZERO);
}
