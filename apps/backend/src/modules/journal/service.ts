import { Prisma } from "@prisma/client";
import type { JournalEntryDetail } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { createJournalEntry } from "../../lib/journal.js";
import { assertUnitAccess } from "../../lib/unit-access.js";
import { assertFiscalYearOpen } from "./year-close.js";
import type { CreateManualJournalInput, ReverseManualJournalInput } from "./schema.js";

const ENTRY_INCLUDE = { lines: { include: { account: true }, orderBy: { id: "asc" } } } as const satisfies Prisma.JournalEntryInclude;
type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

function toDetail(entry: EntryRow): JournalEntryDetail {
  return {
    id: entry.id,
    entryNo: entry.entryNo,
    entryDate: entry.entryDate.toISOString().split("T")[0]!,
    description: entry.description,
    entryType: entry.entryType,
    sourceType: entry.sourceType,
    unitId: entry.unitId,
    reversalOfId: entry.reversalOfId,
    createdAt: entry.createdAt.toISOString(),
    lines: entry.lines.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      accountCode: l.account.code,
      accountName: l.account.name,
      debit: l.debit.toString(),
      credit: l.credit.toString()
    }))
  };
}

async function loadEntry(tenantId: string, id: string) {
  const entry = await db.journalEntry.findFirst({ where: { id, tenantId }, include: ENTRY_INCLUDE });
  if (!entry) throw notFound("Jurnal tidak ditemukan");
  return entry;
}

async function resolveUnitId(tenantId: string, userId: string, unitId: string | null | undefined): Promise<string | null> {
  if (!unitId) return null;
  const unit = await db.cooperativeUnit.findFirst({ where: { id: unitId, tenantId, isActive: true }, select: { id: true } });
  if (!unit) throw notFound("Unit tidak ditemukan");
  await assertUnitAccess(userId, tenantId, unit.id);
  return unit.id;
}

/**
 * Books a hand-keyed entry. Every rule that makes it safe to post lives here, before
 * the ledger is touched: exactly one positive side per line, accounts that belong to
 * this tenant, are active and are postable (not group headers), and debits = credits.
 */
export async function createManualJournal(
  tenantId: string,
  userId: string,
  input: CreateManualJournalInput
): Promise<JournalEntryDetail> {
  const lines = input.lines.map((l, i) => {
    const debit = new Prisma.Decimal(l.debit ?? 0);
    const credit = new Prisma.Decimal(l.credit ?? 0);
    if (debit.gt(0) === credit.gt(0)) {
      throw validationError(`Baris ${i + 1}: isi salah satu saja, debit atau kredit, dengan jumlah lebih dari 0`);
    }
    return { accountId: l.accountId, debit, credit };
  });

  const totalDebit = lines.reduce((sum, l) => sum.plus(l.debit), new Prisma.Decimal(0));
  const totalCredit = lines.reduce((sum, l) => sum.plus(l.credit), new Prisma.Decimal(0));
  if (!totalDebit.equals(totalCredit)) {
    throw validationError(`Jurnal tidak seimbang (debit ${totalDebit.toString()} ≠ kredit ${totalCredit.toString()})`);
  }

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await db.account.findMany({ where: { tenantId, id: { in: accountIds } } });
  if (accounts.length !== accountIds.length) throw notFound("Akun tidak ditemukan");
  const unusable = accounts.find((a) => a.isHeader || !a.isActive);
  if (unusable) {
    throw validationError(`Akun ${unusable.code} ${unusable.name} tidak dapat dipakai (akun induk atau nonaktif)`);
  }

  const entryDate = new Date(input.entryDate);
  await assertFiscalYearOpen(tenantId, entryDate);
  const unitId = await resolveUnitId(tenantId, userId, input.unitId);

  const entry = await db.$transaction((tx) =>
    createJournalEntry(tx, {
      tenantId,
      unitId,
      entryDate,
      sourceType: "MANUAL",
      sourceId: null,
      description: input.description,
      lines,
      entryType: input.entryType,
      createdById: userId
    })
  );
  return toDetail(await loadEntry(tenantId, entry.id));
}

/**
 * Cancels a manual entry by booking its mirror image (debits and credits swapped) —
 * the original is never edited or deleted, so the ledger keeps the audit trail.
 * System-posted entries are refused: they are tied to a source row (a sale, a loan
 * payment) and reversing only the ledger side would desync the two.
 */
export async function reverseManualJournal(
  tenantId: string,
  userId: string,
  id: string,
  input: ReverseManualJournalInput
): Promise<JournalEntryDetail> {
  const original = await loadEntry(tenantId, id);
  if (original.sourceType !== "MANUAL") {
    throw validationError("Hanya jurnal manual yang dapat dibalik; jurnal otomatis dibatalkan lewat transaksi asalnya");
  }
  if (original.reversalOfId) throw validationError("Jurnal pembalik tidak dapat dibalik lagi");

  const reversalDate = input.entryDate ? new Date(input.entryDate) : new Date();
  await assertFiscalYearOpen(tenantId, reversalDate);

  const reversal = await db.$transaction(async (tx) => {
    // The unique reversalOfId is the real guard against a double reversal under concurrency;
    // this pre-check just turns the common case into a clean 409.
    if (await tx.journalEntry.findFirst({ where: { tenantId, reversalOfId: original.id }, select: { id: true } })) {
      throw conflict("Jurnal ini sudah pernah dibalik");
    }
    return createJournalEntry(tx, {
      tenantId,
      unitId: original.unitId,
      entryDate: reversalDate,
      sourceType: "MANUAL",
      sourceId: null,
      description: `Pembalik: ${original.description}`,
      lines: original.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
      entryType: original.entryType,
      createdById: userId,
      reversalOfId: original.id
    });
  });
  return toDetail(await loadEntry(tenantId, reversal.id));
}
