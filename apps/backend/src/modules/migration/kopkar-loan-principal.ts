import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { KOPKAR_RAT_TENANT_ID, type RatLoanPrincipalOpening } from "@siskop/types";
import { z } from "zod";
import { db, type TxClient } from "../../lib/db.js";
import { conflict, forbidden, validationError } from "../../lib/errors.js";
import { createJournalEntry } from "../../lib/journal.js";
import { dateKey, parseDateKey } from "../../lib/operating-calendar.js";
import { getEffectiveUnitIds } from "../../lib/unit-access.js";
import { recordAudit } from "../audit-log/service.js";
import { loadRatPublishSource } from "./kopkar-rat.js";

const kind = "loan_principal";
const cutoffDate = "2025-12-31";
const receivableCode = "1-1100";
const offsetCode = "3-9010";
const decimal = z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/);
export const ratLoanPrincipalBody = z.object({
  excelAmount: decimal, neracaAmount: decimal, confirmed: z.literal(true)
}).strict();

function assertScope(tenantId: string) {
  if (tenantId !== KOPKAR_RAT_TENANT_ID) throw forbidden("Saldo pokok RAT ini khusus Kopkar UM Surabaya.");
}

function readAmount(value: string | null) {
  if (!value || !decimal.safeParse(value).success) throw validationError("Nilai piutang RAT tidak lengkap.");
  return new Prisma.Decimal(value);
}

async function existingJournal(tx: TxClient, tenantId: string): Promise<RatLoanPrincipalOpening["journal"]> {
  const published = await tx.kopkarRatPublication.findFirst({ where: { tenantId, kind }, select: { recordId: true } });
  if (!published) return null;
  const journal = await tx.journalEntry.findFirstOrThrow({
    where: { tenantId, id: published.recordId }, select: { id: true, entryNo: true, reversedBy: { select: { entryDate: true } } }
  });
  if (journal.entryNo === null) throw conflict("Nomor jurnal saldo pokok tidak tersedia.");
  return { id: journal.id, entryNo: journal.entryNo, reversedOn: journal.reversedBy ? dateKey(journal.reversedBy.entryDate) : null };
}

function summarize(source: Awaited<ReturnType<typeof loadRatPublishSource>>): Omit<RatLoanPrincipalOpening, "journal"> {
  if (!source.loan.length || !source.loanNeraca.length) throw validationError("Rincian pinjaman atau Neraca RAT tidak tersedia.");
  const zero = new Prisma.Decimal(0);
  const excel = source.loan.reduce((total, row) => {
    const principal = readAmount(row.value);
    if (!principal.gt(0)) throw validationError("Sisa pokok pada baris " + row.sourceRow + " harus positif.");
    return total.plus(principal);
  }, zero);
  const neraca = source.loanNeraca.reduce((total, value) => total.plus(readAmount(value)), zero);
  if (!decimal.safeParse(excel.toFixed(2)).success) throw validationError("Jumlah sisa pokok melebihi kapasitas jurnal.");
  return { cutoffDate, receivableCode, offsetCode, sourceRows: source.loan.length,
    excelAmount: excel.toFixed(2), neracaAmount: neraca.toFixed(2), difference: excel.minus(neraca).toFixed(2) };
}

export async function readRatLoanPrincipalOpening(tenantId: string): Promise<RatLoanPrincipalOpening> {
  assertScope(tenantId);
  const [source, journal] = await Promise.all([loadRatPublishSource(), existingJournal(db, tenantId)]);
  return { ...summarize(source), journal };
}

export async function postRatLoanPrincipalOpening(
  tenantId: string, actorId: string, input: z.infer<typeof ratLoanPrincipalBody>
): Promise<RatLoanPrincipalOpening> {
  assertScope(tenantId);
  const [source, allowedUnits] = await Promise.all([loadRatPublishSource(), getEffectiveUnitIds(actorId, tenantId)]);
  const summary = summarize(source);
  if (!readAmount(input.excelAmount).eq(summary.excelAmount) || !readAmount(input.neracaAmount).eq(summary.neracaAmount)) {
    throw conflict("Nilai arsip berubah. Periksa ulang sebelum membukukan.");
  }
  const entryDate = parseDateKey(cutoffDate);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const journal = await existingJournal(tx, tenantId);
    if (journal) return { ...summary, journal };

    if (await tx.fiscalYearClose.findFirst({ where: { tenantId, year: 2025, reopenedAt: null }, select: { id: true } })) {
      throw conflict("Tahun buku 2025 sudah ditutup.");
    }
    if (await tx.loan.count({ where: { tenantId } }) ||
        await tx.kopkarRatPublication.count({ where: { tenantId, kind: "loan" } })) {
      throw conflict("Terdapat pinjaman aktif atau terbitan RAT. Rekonsiliasi sebelum membukukan saldo pokok.");
    }
    const units = await tx.cooperativeUnit.findMany({
      where: { tenantId, id: { in: allowedUnits }, isActive: true, type: "KSP" }, take: 2, select: { id: true }
    });
    if (units.length !== 1) throw conflict("Pilih satu unit simpan pinjam yang aktif.");
    const unitId = units[0]!.id;

    const sourceMembers = new Map(source.member.map((row) => [row.ownerRef, row.sourceRow]));
    const links = await tx.kopkarRatPublication.findMany({ where: { tenantId, kind: "member" }, select: { sourceRow: true, recordId: true } });
    const linkByRow = new Map(links.map(({ sourceRow, recordId }) => [sourceRow, recordId]));
    const active = new Set((await tx.member.findMany({
      where: { tenantId, isActive: true, memberships: { some: { unitId } }, id: { in: links.map((row) => row.recordId) } },
      select: { id: true }
    })).map(({ id }) => id));
    for (const row of source.loan) {
      const owner = sourceMembers.get(row.ownerRef);
      if (owner === undefined || !active.has(linkByRow.get(owner) ?? "")) {
        throw validationError("Pemilik pinjaman pada baris " + row.sourceRow + " belum tertaut ke anggota aktif.");
      }
    }
    const accounts = await tx.account.findMany({
      where: { tenantId, code: { in: [receivableCode, offsetCode] }, isActive: true, isHeader: false, isCashEquivalent: false },
      select: { id: true, code: true, category: true }
    });
    const receivable = accounts.find((account) => account.code === receivableCode && account.category === "ASET");
    const offset = accounts.find((account) => account.code === offsetCode && account.category === "EKUITAS");
    if (!receivable || !offset) throw validationError("Akun piutang dan akun penampung RAT harus aktif.");
    if (await tx.journalLine.findFirst({
      where: { tenantId, accountId: receivable.id, journalEntry: { status: "POSTED", entryDate: { lte: entryDate } } },
      select: { id: true }
    })) throw conflict("Piutang sudah memiliki jurnal pada tanggal saldo awal. Rekonsiliasi sebelum membukukan.");

    const principal = readAmount(summary.excelAmount);
    const entry = await createJournalEntry(tx, {
      tenantId, unitId, entryDate, sourceType: "MANUAL", sourceId: null,
      entryType: "PENYESUAIAN", createdById: actorId,
      description: "Saldo awal pokok pinjaman Excel RAT 2025 · Belum terverifikasi · Selisih terhadap Neraca Rp " + summary.difference,
      lines: [{ accountId: receivable.id, debit: principal }, { accountId: offset.id, credit: principal }]
    });
    const batchHash = randomUUID();
    await tx.kopkarRatPublication.createMany({ data: source.loan.map(({ sourceRow }) => ({
      tenantId, kind, sourceRow, recordId: entry.id, recordKey: String(sourceRow), publishedBy: actorId,
      batchHash, journalEntryNo: entry.entryNo, verificationRef: "Total Excel RAT 2025; selisih Neraca belum terverifikasi."
    })) });
    await recordAudit(tx, { action: "rat.loan_principal_opening", entityType: "JournalEntry", entityId: entry.id,
      after: { ...summary, journalEntryNo: entry.entryNo, unitId } });
    return { ...summary, journal: { id: entry.id, entryNo: entry.entryNo, reversedOn: null } };
  }, { timeout: 30000 });
}

export async function assertRatLoanPrincipalNotBooked(tx: TxClient, tenantId: string, postingDate: string) {
  const journal = await existingJournal(tx, tenantId);
  if (journal && (!journal.reversedOn || postingDate < journal.reversedOn)) {
    throw conflict("Saldo pokok Excel sudah dibukukan pada jurnal " + journal.entryNo + ". Tanggal pembukuan kontrak tidak boleh mendahului pembalikannya.");
  }
}
