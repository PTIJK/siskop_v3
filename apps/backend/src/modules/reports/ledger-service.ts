import { Prisma, type JournalEntryType } from "@prisma/client";
import type { BukuBesarAccount, JurnalReport, TrialBalance } from "@siskop/types";
import { db } from "../../lib/db.js";
import { notFound, validationError } from "../../lib/errors.js";
import {
  accountLevels,
  isContraAccount,
  normalBalanceAmount,
  orderDepthFirst,
  rollUpSums,
  type DebitCredit
} from "../../lib/account-tree.js";
import { businessDate, dateKey } from "../../lib/operating-calendar.js";
import { assertValidPeriod } from "./regulatory-service.js";

/**
 * The books behind the regulatory statements: Jurnal Umum / Penyesuaian, Neraca Saldo
 * (trial balance), Buku Besar. All of them read JournalLine straight from the ledger,
 * aggregate in SQL (groupBy / count / aggregate, never a table-wide load), and share the
 * same unit semantics as the statements:
 *   unit === undefined -> consolidated (every entry, unit-less ones included)
 *   unit === string    -> that unit's entries only
 *   unit === null      -> the tenant-level "unallocated" bucket (entries with no unit)
 * so per-unit figures plus the unallocated bucket always add back to the consolidated one.
 */
export type UnitScope = string | null | undefined;

export interface BookPeriod {
  start: Date;
  end: Date;
}

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const ZERO = () => D(0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toString();
const day = (d: Date) => dateKey(businessDate(d));
const periode = (p: BookPeriod) => ({ from: day(p.start), to: day(p.end) });

const unitFilter = (unit: UnitScope): Prisma.JournalEntryWhereInput => (unit === undefined ? {} : { unitId: unit });

export interface JurnalFilter {
  period: BookPeriod;
  unit: UnitScope;
  entryType?: JournalEntryType;
  sourceType?: string;
  page: number;
  limit: number;
}

/** Jurnal Umum (any type) and Jurnal Penyesuaian (`entryType: PENYESUAIAN`): one function, one row shape. */
export async function getJurnal(
  tenantId: string,
  f: JurnalFilter
): Promise<{ report: JurnalReport; total: number }> {
  assertValidPeriod(f.period.start, f.period.end);
  const entry: Prisma.JournalEntryWhereInput = {
    tenantId,
    entryDate: { gte: f.period.start, lte: f.period.end },
    ...unitFilter(f.unit),
    ...(f.entryType ? { entryType: f.entryType } : {}),
    ...(f.sourceType ? { sourceType: f.sourceType as Prisma.JournalEntryWhereInput["sourceType"] } : {})
  };
  const where: Prisma.JournalLineWhereInput = { tenantId, journalEntry: entry };

  const [lines, total, sums] = await Promise.all([
    db.journalLine.findMany({
      where,
      include: { journalEntry: true, account: true },
      orderBy: [{ journalEntry: { entryDate: "asc" } }, { journalEntry: { entryNo: "asc" } }, { id: "asc" }],
      skip: (f.page - 1) * f.limit,
      take: f.limit
    }),
    db.journalLine.count({ where }),
    db.journalLine.aggregate({ where, _sum: { debit: true, credit: true } })
  ]);

  const totalDebit = D(sums._sum.debit ?? 0);
  const totalCredit = D(sums._sum.credit ?? 0);
  return {
    total,
    report: {
      periode: periode(f.period),
      rows: lines.map((l) => ({
        lineId: l.id,
        entryId: l.journalEntryId,
        entryNo: l.journalEntry.entryNo,
        entryDate: day(l.journalEntry.entryDate),
        description: l.journalEntry.description,
        entryType: l.journalEntry.entryType,
        sourceType: l.journalEntry.sourceType,
        sourceId: l.journalEntry.sourceId,
        unitId: l.journalEntry.unitId,
        accountId: l.accountId,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: money(D(l.debit)),
        credit: money(D(l.credit))
      })),
      totalDebit: money(totalDebit),
      totalCredit: money(totalCredit),
      balanced: totalDebit.equals(totalCredit)
    }
  };
}

type Sums = Map<string, DebitCredit>;

async function sumsByAccount(tenantId: string, unit: UnitScope, entryDate: Prisma.DateTimeFilter): Promise<Sums> {
  const rows = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { tenantId, journalEntry: { tenantId, entryDate, ...unitFilter(unit) } },
    _sum: { debit: true, credit: true }
  });
  return new Map(rows.map((r) => [r.accountId, { debit: D(r._sum.debit ?? 0), credit: D(r._sum.credit ?? 0) }]));
}

/**
 * Neraca Saldo: per account the opening balance (everything before the period), the
 * period's debit/credit movement and the closing balance, headers rolled up from their
 * children. Balances are signed by each account's own normal side and are NOT netted for
 * contra accounts: a trial balance lists every account on the side it actually sits on.
 */
export async function getNeracaSaldo(tenantId: string, period: BookPeriod, unit: UnitScope): Promise<TrialBalance> {
  assertValidPeriod(period.start, period.end);
  const [accounts, before, within] = await Promise.all([
    db.account.findMany({ where: { tenantId }, orderBy: { code: "asc" } }),
    sumsByAccount(tenantId, unit, { lt: period.start }),
    sumsByAccount(tenantId, unit, { gte: period.start, lte: period.end })
  ]);

  const rolledBefore = rollUpSums(accounts, before);
  const rolledWithin = rollUpSums(accounts, within);
  const levels = accountLevels(accounts);
  const zero: DebitCredit = { debit: ZERO(), credit: ZERO() };

  const rows = orderDepthFirst(accounts).map((a) => {
    const awal = normalBalanceAmount(a.normalBalance, rolledBefore.get(a.id) ?? zero);
    const mutasi = rolledWithin.get(a.id) ?? zero;
    const movement = normalBalanceAmount(a.normalBalance, mutasi);
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      category: a.category,
      normalBalance: a.normalBalance,
      level: levels.get(a.id) ?? 1,
      parentId: a.parentId,
      isHeader: a.isHeader,
      isContra: isContraAccount(a.category, a.normalBalance),
      saldoAwal: money(awal),
      mutasiDebit: money(mutasi.debit),
      mutasiKredit: money(mutasi.credit),
      saldoAkhir: money(awal.plus(movement))
    };
  });

  // Totals over posting accounts only: a header already carries its children's figures.
  const posting = rows.filter((r) => !r.isHeader);
  const sum = (pick: (r: (typeof rows)[number]) => string) => posting.reduce((s, r) => s.plus(pick(r)), ZERO());
  const mutasiDebit = sum((r) => r.mutasiDebit);
  const mutasiKredit = sum((r) => r.mutasiKredit);
  const saldoAkhirDebit = posting.filter((r) => r.normalBalance === "DEBIT").reduce((s, r) => s.plus(r.saldoAkhir), ZERO());
  const saldoAkhirKredit = posting.filter((r) => r.normalBalance === "KREDIT").reduce((s, r) => s.plus(r.saldoAkhir), ZERO());

  return {
    periode: periode(period),
    rows,
    totals: {
      mutasiDebit: money(mutasiDebit),
      mutasiKredit: money(mutasiKredit),
      saldoAkhirDebit: money(saldoAkhirDebit),
      saldoAkhirKredit: money(saldoAkhirKredit)
    },
    balanced: mutasiDebit.equals(mutasiKredit) && saldoAkhirDebit.equals(saldoAkhirKredit)
  };
}

/** Buku Besar overview: the trial balance minus accounts that are untouched and empty. */
export async function getBukuBesar(tenantId: string, period: BookPeriod, unit: UnitScope): Promise<TrialBalance> {
  const tb = await getNeracaSaldo(tenantId, period, unit);
  const active = (r: TrialBalance["rows"][number]) =>
    Number(r.saldoAwal) !== 0 || Number(r.mutasiDebit) !== 0 || Number(r.mutasiKredit) !== 0 || Number(r.saldoAkhir) !== 0;
  return { ...tb, rows: tb.rows.filter(active) };
}

/**
 * One account's ledger: opening balance, each posting with the running balance after it,
 * closing balance. Paginated; the running balance stays continuous across pages because
 * the preceding postings' net is folded into the page's starting point.
 */
export async function getBukuBesarAccount(
  tenantId: string,
  accountId: string,
  period: BookPeriod,
  unit: UnitScope,
  page: number,
  limit: number
): Promise<{ report: BukuBesarAccount; total: number }> {
  assertValidPeriod(period.start, period.end);
  const account = await db.account.findFirst({ where: { id: accountId, tenantId } });
  if (!account) throw notFound("Akun tidak ditemukan");
  if (account.isHeader) throw validationError("Akun induk tidak memiliki mutasi sendiri, pilih akun rinci");

  const sign = (debit: Prisma.Decimal.Value, credit: Prisma.Decimal.Value) =>
    normalBalanceAmount(account.normalBalance, { debit: D(debit), credit: D(credit) });

  const base = (entryDate: Prisma.DateTimeFilter): Prisma.JournalLineWhereInput => ({
    tenantId,
    accountId,
    journalEntry: { tenantId, entryDate, ...unitFilter(unit) }
  });
  const inPeriod = base({ gte: period.start, lte: period.end });
  const order = [{ journalEntry: { entryDate: "asc" } }, { journalEntry: { entryNo: "asc" } }, { id: "asc" }] as const;
  const skip = (page - 1) * limit;

  const [opening, periodTotals, total, preceding, pageLines] = await Promise.all([
    db.journalLine.aggregate({ where: base({ lt: period.start }), _sum: { debit: true, credit: true } }),
    db.journalLine.aggregate({ where: inPeriod, _sum: { debit: true, credit: true } }),
    db.journalLine.count({ where: inPeriod }),
    // Only the postings before this page, and only their amounts.
    skip > 0
      ? db.journalLine.findMany({ where: inPeriod, orderBy: [...order], take: skip, select: { debit: true, credit: true } })
      : Promise.resolve([]),
    db.journalLine.findMany({ where: inPeriod, orderBy: [...order], skip, take: limit, include: { journalEntry: true } })
  ]);

  const saldoAwal = sign(opening._sum.debit ?? 0, opening._sum.credit ?? 0);
  let running = preceding.reduce((s, l) => s.plus(sign(l.debit, l.credit)), saldoAwal);
  const lines = pageLines.map((l) => {
    running = running.plus(sign(l.debit, l.credit));
    return {
      lineId: l.id,
      entryId: l.journalEntryId,
      entryNo: l.journalEntry.entryNo,
      entryDate: day(l.journalEntry.entryDate),
      description: l.journalEntry.description,
      entryType: l.journalEntry.entryType,
      sourceType: l.journalEntry.sourceType,
      sourceId: l.journalEntry.sourceId,
      debit: money(D(l.debit)),
      credit: money(D(l.credit)),
      saldo: money(running)
    };
  });

  const movementTotal = sign(periodTotals._sum.debit ?? 0, periodTotals._sum.credit ?? 0);
  return {
    total,
    report: {
      periode: periode(period),
      account: { id: account.id, code: account.code, name: account.name, normalBalance: account.normalBalance },
      saldoAwal: money(saldoAwal),
      lines,
      totalDebit: money(D(periodTotals._sum.debit ?? 0)),
      totalCredit: money(D(periodTotals._sum.credit ?? 0)),
      saldoAkhir: money(saldoAwal.plus(movementTotal))
    }
  };
}
