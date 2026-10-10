import { Prisma } from "@prisma/client";
import type { YearCloseList, YearClosePlan, YearCloseResult, YearCloseState, YearCloseStatus } from "@siskop/types";
import { templateCode } from "../../lib/coaTemplate.js";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { createJournalEntry } from "../../lib/journal.js";
import { businessDate, dateKey, endOfBusinessDay, startOfBusinessDay } from "../../lib/operating-calendar.js";

/**
 * Tutup Buku: at year end, income and expense are moved into equity by closing entries
 * (entryType PENUTUP, sourceType CLOSING), one per unit scope, so each unit's figures —
 * and the unallocated bucket's — still add back to the consolidated ones. After a close,
 * the next year opens with income and expense accounts at zero (the Neraca opening
 * balances no longer carry old results) while the closed year's income statement, which
 * ignores PENUTUP, still shows its real activity.
 */

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toString();

/** Asia/Jakarta calendar year of an instant. */
export function businessYear(d: Date = new Date()): number {
  return Number(dateKey(businessDate(d)).slice(0, 4));
}

/** Manual journals refuse to touch a closed year; reopen it first. */
export async function assertFiscalYearOpen(tenantId: string, date: Date): Promise<void> {
  const year = businessYear(date);
  const closed = await db.fiscalYearClose.findFirst({ where: { tenantId, year, reopenedAt: null }, select: { id: true } });
  if (closed) throw conflict(`Tahun buku ${year} sudah ditutup; buka kembali dahulu untuk mencatat jurnal pada tahun tersebut`);
}

function statusOf(row: { reopenedAt: Date | null } | undefined): YearCloseStatus {
  if (!row) return "OPEN";
  return row.reopenedAt ? "REOPENED" : "CLOSED";
}

export async function listYearCloses(tenantId: string): Promise<YearCloseList> {
  const currentYear = businessYear();
  const [first, closes] = await Promise.all([
    db.journalEntry.aggregate({ where: { tenantId, status: "POSTED" }, _min: { entryDate: true } }),
    db.fiscalYearClose.findMany({ where: { tenantId } })
  ]);
  const byYear = new Map(closes.map((c) => [c.year, c]));
  // No ledger activity yet: nothing to close.
  if (!first._min.entryDate) return { currentYear, years: [] };
  const firstYear = businessYear(first._min.entryDate);

  const years: YearCloseList["years"] = [];
  for (let year = currentYear - 1; year >= Math.min(firstYear, currentYear - 1); year--) {
    const row = byYear.get(year);
    years.push({
      year,
      status: statusOf(row),
      closedAt: row?.closedAt.toISOString() ?? null,
      reopenedAt: row?.reopenedAt?.toISOString() ?? null
    });
  }
  return { currentYear, years };
}

async function resolveTarget(tenantId: string, targetAccountId?: string) {
  const account = targetAccountId
    ? await db.account.findFirst({ where: { id: targetAccountId, tenantId } })
    : await db.account.findFirst({ where: { tenantId, code: templateCode("shu_lalu") } });
  if (!account) {
    if (targetAccountId) throw notFound("Akun tujuan tidak ditemukan");
    throw validationError("Akun SHU Tahun Lalu (3-3100) tidak ditemukan; pilih akun ekuitas tujuan penutupan");
  }
  if (account.category !== "EKUITAS" || account.isHeader || !account.isActive) {
    throw validationError("Akun tujuan penutupan harus akun Ekuitas rinci yang aktif");
  }
  return account;
}

interface ResultRow {
  unitId: string | null;
  accountId: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

/** The closing entries a year would get; the same plan is previewed and then posted. */
export async function planYearClose(tenantId: string, year: number, targetAccountId?: string): Promise<YearClosePlan> {
  if (!Number.isInteger(year) || year < 2000 || year >= businessYear()) {
    throw validationError("Hanya tahun buku yang sudah berakhir yang dapat ditutup");
  }
  const target = await resolveTarget(tenantId, targetAccountId);
  const start = startOfBusinessDay(new Date(`${year}-01-01`));
  const end = endOfBusinessDay(new Date(`${year}-12-31`));

  // Parameterised raw SQL: groupBy cannot group by a relation column (the entry's unit), and
  // this has to aggregate per (unit, account) in the database, not in Node.
  const rows = await db.$queryRaw<ResultRow[]>(Prisma.sql`
    SELECT je."unitId" AS "unitId", jl."accountId" AS "accountId",
           SUM(jl."debit") AS "debit", SUM(jl."credit") AS "credit"
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je."id" = jl."journalEntryId"
    JOIN "Account" a ON a."id" = jl."accountId"
    WHERE je."tenantId" = ${tenantId}
      AND jl."tenantId" = ${tenantId}
      AND a."tenantId" = ${tenantId}
      AND a."category" IN ('PENDAPATAN', 'BEBAN')
      AND je."entryType" <> 'PENUTUP'
      AND je."entryDate" >= ${start}
      AND je."entryDate" <= ${end}
    GROUP BY je."unitId", jl."accountId"
  `);

  const [accounts, units] = await Promise.all([
    db.account.findMany({ where: { tenantId, id: { in: [...new Set(rows.map((r) => r.accountId))] } } }),
    db.cooperativeUnit.findMany({ where: { tenantId } })
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));

  const byScope = new Map<string | null, ResultRow[]>();
  for (const r of rows) byScope.set(r.unitId, [...(byScope.get(r.unitId) ?? []), r]);

  const line = (accountId: string, debit: Prisma.Decimal, credit: Prisma.Decimal) => {
    const a = accountId === target.id ? target : accountById.get(accountId)!;
    return { accountId, accountCode: a.code, accountName: a.name, debit: money(debit), credit: money(credit) };
  };

  const entries = [...byScope.entries()]
    .map(([unitId, scopeRows]) => {
      const lines = [];
      let balance = D(0); // Σ(debit - credit) over the scope's income and expense accounts
      for (const r of scopeRows.sort((x, y) => accountById.get(x.accountId)!.code.localeCompare(accountById.get(y.accountId)!.code))) {
        const bal = D(r.debit).minus(r.credit);
        if (bal.isZero()) continue;
        balance = balance.plus(bal);
        // Zero the account: a debit balance is credited, a credit balance debited.
        lines.push(bal.gt(0) ? line(r.accountId, D(0), bal) : line(r.accountId, bal.negated(), D(0)));
      }
      const netIncome = balance.negated();
      if (!netIncome.isZero()) lines.push(netIncome.gt(0) ? line(target.id, D(0), netIncome) : line(target.id, netIncome.negated(), D(0)));
      return { unitId, unitName: unitId ? (unitName.get(unitId) ?? null) : null, netIncome: money(netIncome), lines };
    })
    .filter((e) => e.lines.length > 0)
    // units by name first, the unallocated bucket last
    .sort((x, y) => (x.unitId === null ? 1 : 0) - (y.unitId === null ? 1 : 0) || (x.unitName ?? "").localeCompare(y.unitName ?? ""));

  return {
    year,
    targetAccount: { id: target.id, code: target.code, name: target.name },
    netIncome: money(entries.reduce((s, e) => s.plus(e.netIncome), D(0))),
    entries
  };
}

export async function closeYear(tenantId: string, userId: string, year: number, targetAccountId?: string): Promise<YearCloseResult> {
  const plan = await planYearClose(tenantId, year, targetAccountId);

  const start = startOfBusinessDay(new Date(`${year}-01-01`));
  const end = endOfBusinessDay(new Date(`${year}-12-31`));
  const unposted = await db.journalEntry.count({
    where: { tenantId, status: "UNPOSTED_MISSING_MAPPING", entryDate: { gte: start, lte: end } }
  });
  if (unposted > 0) {
    throw conflict(`Masih ada ${unposted} transaksi belum terposting di tahun ${year}; posting ulang dahulu agar hasil usaha lengkap`);
  }

  const record = await db.$transaction(async (tx) => {
    const existing = await tx.fiscalYearClose.findUnique({ where: { tenantId_year: { tenantId, year } } });
    if (existing && !existing.reopenedAt) throw conflict(`Tahun buku ${year} sudah ditutup`);

    const row = existing
      ? await tx.fiscalYearClose.update({ where: { id: existing.id, tenantId }, data: { closedAt: new Date(), closedById: userId, reopenedAt: null, reopenedById: null } })
      : await tx.fiscalYearClose.create({ data: { tenantId, year, closedById: userId } });

    for (const entry of plan.entries) {
      await createJournalEntry(tx, {
        tenantId,
        unitId: entry.unitId,
        entryDate: new Date(`${year}-12-31`),
        sourceType: "CLOSING",
        sourceId: row.id,
        description: `Penutupan buku tahun ${year}`,
        lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: D(l.debit), credit: D(l.credit) })),
        entryType: "PENUTUP",
        createdById: userId
      });
    }
    return row;
  });

  return { ...plan, status: "CLOSED", closedAt: record.closedAt.toISOString(), reopenedAt: null };
}

/**
 * Reopens a closed year by booking the mirror of each of its closing entries — nothing is
 * deleted, so the audit trail keeps both the close and the reopen. A year cannot be
 * reopened while a later year is closed: that year's opening balances rest on this one.
 */
export async function reopenYear(tenantId: string, userId: string, year: number): Promise<YearCloseState> {
  const record = await db.fiscalYearClose.findUnique({ where: { tenantId_year: { tenantId, year } } });
  if (!record) throw notFound(`Tahun buku ${year} belum pernah ditutup`);
  if (record.reopenedAt) throw conflict(`Tahun buku ${year} sudah dibuka kembali`);

  const later = await db.fiscalYearClose.findFirst({ where: { tenantId, year: { gt: year }, reopenedAt: null }, select: { year: true } });
  if (later) throw conflict(`Tahun buku ${later.year} masih tertutup; buka kembali tahun yang lebih baru terlebih dahulu`);

  const updated = await db.$transaction(async (tx) => {
    const open = await tx.fiscalYearClose.updateMany({ where: { id: record.id, tenantId, reopenedAt: null }, data: { reopenedAt: new Date(), reopenedById: userId } });
    if (open.count !== 1) throw conflict(`Tahun buku ${year} sudah dibuka kembali`);

    const closing = await tx.journalEntry.findMany({
      where: { tenantId, sourceType: "CLOSING", sourceId: record.id, reversalOfId: null, reversedBy: null },
      include: { lines: true }
    });
    for (const entry of closing) {
      await createJournalEntry(tx, {
        tenantId,
        unitId: entry.unitId,
        entryDate: entry.entryDate,
        sourceType: "CLOSING",
        sourceId: record.id,
        description: `Pembukaan kembali buku tahun ${year}`,
        lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
        entryType: "PENUTUP",
        createdById: userId,
        reversalOfId: entry.id
      });
    }
    return tx.fiscalYearClose.findFirstOrThrow({ where: { id: record.id, tenantId } });
  });

  return {
    year,
    status: "REOPENED",
    closedAt: updated.closedAt.toISOString(),
    reopenedAt: updated.reopenedAt?.toISOString() ?? null
  };
}
