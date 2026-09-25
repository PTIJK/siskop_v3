import { EquityClass, Prisma } from "@prisma/client";
import { EQUITY_CLASS_LABELS, type PerubahanEkuitasRowKey } from "@siskop/types";
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

  const sums = await sumsByAccount(
    tenantId,
    accounts.map((a) => a.id),
    asOf,
    undefined,
    unitId
  );

  let total = ZERO;
  for (const account of accounts) {
    const sum = sums.get(account.id);
    if (!sum || !account.equityClass) continue;
    const balance = account.normalBalance === "KREDIT" ? sum.credit.sub(sum.debit) : sum.debit.sub(sum.credit);
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

// ── Laporan Perubahan Ekuitas ─────────────────────────────────────────────────

/**
 * Equity lines in the order Permenkop UKM 2/2024's lampiran presents them:
 * Modal Sendiri classes first, then SHU, penyertaan and other equity.
 */
export const EQUITY_CLASS_ORDER: readonly EquityClass[] = [
  "SIMPANAN_POKOK",
  "MODAL_TETAP",
  "SIMPANAN_WAJIB",
  "CADANGAN_UMUM",
  "CADANGAN_RISIKO",
  "HIBAH",
  "SHU",
  "MODAL_PENYERTAAN",
  "EKUITAS_LAIN"
];

const UNCLASSIFIED = "BELUM_DIKLASIFIKASI" as const;
type ColumnKey = EquityClass | typeof UNCLASSIFIED;

type Sums = { debit: Prisma.Decimal; credit: Prisma.Decimal };

/** Decimal debit/credit sums per account, over entries dated in [from, to] (from omitted = since inception). */
async function sumsByAccount(tenantId: string, accountIds: string[], to: Date, from?: Date, unitId?: string) {
  if (accountIds.length === 0) return new Map<string, Sums>();
  const rows = await db.journalLine.groupBy({
    by: ["accountId"],
    where: {
      tenantId,
      accountId: { in: accountIds },
      journalEntry: { entryDate: { ...(from ? { gte: from } : {}), lte: to }, ...(unitId ? { unitId } : {}) }
    },
    _sum: { debit: true, credit: true }
  });
  return new Map<string, Sums>(rows.map((r) => [r.accountId, { debit: r._sum.debit ?? ZERO, credit: r._sum.credit ?? ZERO }]));
}

/**
 * Laporan Perubahan Ekuitas for [from, to]: per equity class, saldo awal
 * (cumulative to the day before `from`), penambahan / pengurangan (movements
 * on the account's normal / opposite side), SHU periode berjalan and saldo
 * akhir. Income is never closed into equity by a journal (see getNeraca), so
 * the SHU column carries unclosed pendapatan − beban the same way the Neraca's
 * computed line does — which is what makes saldo akhir equal the Neraca's
 * ekuitas total at `to`. Per-unit with `unitId` (CLAUDE.md rule 2b).
 */
export async function getPerubahanEkuitas(tenantId: string, from: Date, to: Date, unitId?: string) {
  const dayBeforeFrom = new Date(from.getTime() - 1);
  const accounts = await db.account.findMany({
    where: { tenantId, isHeader: false, category: { in: ["EKUITAS", "PENDAPATAN", "BEBAN"] } },
    select: { id: true, category: true, normalBalance: true, equityClass: true }
  });
  const ids = accounts.map((a) => a.id);

  const [opening, movement, modalAwal, modalAkhir] = await Promise.all([
    sumsByAccount(tenantId, ids, dayBeforeFrom, undefined, unitId),
    sumsByAccount(tenantId, ids, to, from, unitId),
    getModalSendiri(tenantId, dayBeforeFrom, unitId),
    getModalSendiri(tenantId, to, unitId)
  ]);

  const hasUnclassified = accounts.some((a) => a.category === "EKUITAS" && a.equityClass === null);
  const columnKeys: ColumnKey[] = [...EQUITY_CLASS_ORDER, ...(hasUnclassified ? [UNCLASSIFIED] : [])];
  const blank = () => Object.fromEntries(columnKeys.map((k) => [k, ZERO])) as Record<ColumnKey, Prisma.Decimal>;
  const saldoAwal = blank();
  const penambahan = blank();
  const pengurangan = blank();
  const shuPeriode = blank();

  let incomeBefore = ZERO;
  let incomeInPeriod = ZERO;
  for (const account of accounts) {
    const open = opening.get(account.id) ?? { debit: ZERO, credit: ZERO };
    const move = movement.get(account.id) ?? { debit: ZERO, credit: ZERO };
    const kredit = account.normalBalance === "KREDIT";
    const openBalance = kredit ? open.credit.sub(open.debit) : open.debit.sub(open.credit);

    if (account.category === "EKUITAS") {
      const key: ColumnKey = account.equityClass ?? UNCLASSIFIED;
      saldoAwal[key] = saldoAwal[key].add(openBalance);
      penambahan[key] = penambahan[key].add(kredit ? move.credit : move.debit);
      pengurangan[key] = pengurangan[key].add(kredit ? move.debit : move.credit);
    } else {
      // PENDAPATAN adds to SHU, BEBAN takes from it.
      const sign = account.category === "PENDAPATAN" ? 1 : -1;
      const moveBalance = kredit ? move.credit.sub(move.debit) : move.debit.sub(move.credit);
      incomeBefore = incomeBefore.add(openBalance.mul(sign));
      incomeInPeriod = incomeInPeriod.add(moveBalance.mul(sign));
    }
  }
  saldoAwal.SHU = saldoAwal.SHU.add(incomeBefore);
  shuPeriode.SHU = incomeInPeriod;

  const saldoAkhir = blank();
  for (const key of columnKeys) {
    saldoAkhir[key] = saldoAwal[key].add(penambahan[key]).sub(pengurangan[key]).add(shuPeriode[key]);
  }

  const toRow = (key: PerubahanEkuitasRowKey, label: string, values: Record<ColumnKey, Prisma.Decimal>) => {
    const total = columnKeys.reduce((sum, k) => sum.add(values[k]), ZERO);
    return {
      key,
      label,
      values: Object.fromEntries(columnKeys.map((k) => [k, values[k].toString()])),
      total: total.toString()
    };
  };

  return {
    periode: { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] },
    columns: columnKeys.map((key) => ({
      key,
      label: key === UNCLASSIFIED ? "Belum Diklasifikasi" : EQUITY_CLASS_LABELS[key]
    })),
    rows: [
      toRow("SALDO_AWAL", "Saldo awal", saldoAwal),
      toRow("PENAMBAHAN", "Penambahan", penambahan),
      toRow("PENGURANGAN", "Pengurangan", pengurangan),
      toRow("SHU_PERIODE_BERJALAN", "Sisa hasil usaha periode berjalan", shuPeriode),
      toRow("SALDO_AKHIR", "Saldo akhir", saldoAkhir)
    ],
    modalSendiri: {
      awal: modalAwal.total.toString(),
      akhir: modalAkhir.total.toString(),
      penyesuaianSaldoAwal: modalAkhir.adjustment.toString()
    }
  };
}
