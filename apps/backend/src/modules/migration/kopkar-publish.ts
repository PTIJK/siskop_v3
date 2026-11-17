import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { KOPKAR_RAT_TENANT_ID, type RatPublishKind, type RatPublishOptions, type RatPublishPreview, type RatPublishReceipt } from "@siskop/types";
import { z } from "zod";
import { db, type TxClient } from "../../lib/db.js";
import { conflict, forbidden, validationError } from "../../lib/errors.js";
import { generateAccountNumber, generateMemberId } from "../../lib/id-generator.js";
import { createJournalEntry } from "../../lib/journal.js";
import { getKOLCategory } from "../../lib/kol.js";
import { businessDate, dateKey, endOfBusinessDay, parseDateKey, startOfBusinessDay } from "../../lib/operating-calendar.js";
import { assertQuota } from "../../lib/pricing/entitlements.js";
import { validateRegulatoryRate } from "../../lib/regulatory-config.js";
import { getEffectiveUnitIds } from "../../lib/unit-access.js";
import { recordAudit } from "../audit-log/service.js";
import { ratFinancialFields } from "./kopkar-financial-drafts.js";
import { assertRatLoanPrincipalNotBooked } from "./kopkar-loan-principal.js";
import { loadRatPublishSource } from "./kopkar-rat.js";
import { checkVerifiedMemberBatch, MAX_RAT_BATCH_ROWS, verifiedRatMemberRow } from "./kopkar-verified-members.js";

export const ratPublishKind = z.enum(["member", "saving", "loan"]);
const key = z.string().trim().min(1).max(64);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = parseDateKey(v);
  return Number.isFinite(d.valueOf()) && dateKey(d) === v;
}, "Tanggal tidak valid");
const money = z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/, "Gunakan angka tanpa pemisah ribuan, maksimal 2 desimal");
const principal = money.refine((v) => new Prisma.Decimal(v).gt(0), "Nilai harus lebih besar dari nol");
const sourceRow = z.number().int().min(4).max(10000);
const opening = { unitId: key, cutoffDate: date, offsetAccountId: key, verificationRef: z.string().trim().min(3).max(150) };
const saving = z.object({ sourceRow, productId: key, balance: money }).strict();
const loan = z.object({
  sourceRow, productId: key, contractRef: key, disbursedAt: date, principalAmount: principal, totalAmount: principal,
  remainingPrincipal: principal, remainingAmount: principal, termMonths: z.coerce.number().int().min(1).max(360),
  rate: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/), installmentAmount: principal,
  schedule: z.array(z.object({ dueDate: date, principal: money, margin: money }).strict()).min(1).max(360)
}).strict();

export const ratBatch = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), unitId: key, rows: z.array(verifiedRatMemberRow).min(1).max(MAX_RAT_BATCH_ROWS) }).strict(),
  z.object({ kind: z.literal("saving"), ...opening, rows: z.array(saving).min(1).max(MAX_RAT_BATCH_ROWS) }).strict(),
  z.object({ kind: z.literal("loan"), ...opening, rows: z.array(loan).min(1).max(10) }).strict()
]);
type Batch = z.infer<typeof ratBatch>;
type Actor = { tenantId: string; userId: string };
type Source = Awaited<ReturnType<typeof loadRatPublishSource>>;
const D = (v: string) => new Prisma.Decimal(v);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const offsets = { isActive: true, isHeader: false, isCashEquivalent: false, category: { in: ["ASET", "KEWAJIBAN", "EKUITAS"] } } satisfies Prisma.AccountWhereInput;
const accountName = (a: { code: string; name: string }) => a.code + " · " + a.name;

function assertScope(actor: Actor) {
  if (actor.tenantId !== KOPKAR_RAT_TENANT_ID) throw forbidden("Penerbitan ini khusus Kopkar UM Surabaya.");
}
function rowError(row: number, message: string): never {
  throw validationError("Baris " + row + ": " + message, { row });
}

export async function getRatPublishOptions(actor: Actor, kind: RatPublishKind): Promise<RatPublishOptions> {
  assertScope(actor);
  const { tenantId, userId } = actor;
  const [source, unitIds, publications, products, accounts, corrections, financialCorrections] = await Promise.all([
    loadRatPublishSource(), getEffectiveUnitIds(userId, tenantId),
    db.kopkarRatPublication.findMany({ where: { tenantId, kind }, select: { sourceRow: true } }),
    kind === "saving" ? db.savingConfig.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } })
      : kind === "loan" ? db.loanConfig.findMany({ where: { tenantId, isActive: true, installmentFrequency: "MONTHLY" }, select: { id: true, name: true } }) : [],
    kind === "member" ? [] : db.account.findMany({ where: { tenantId, ...offsets }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    kind === "member" ? db.kopkarRatMemberCorrection.findMany({ where: { tenantId }, select: {
      sourceRow: true, fullName: true, nik: true, address: true, birthPlace: true, birthDate: true, occupation: true
    } }) : [],
    kind === "member" ? [] : db.kopkarRatFinancialCorrection.findMany({ where: { tenantId, kind }, select: { sourceRow: true, fields: true } })
  ]);
  const units = await db.cooperativeUnit.findMany({ where: { tenantId, id: { in: unitIds }, isActive: true, type: "KSP" }, select: { id: true, name: true } });
  const published = new Set(publications.map((r) => r.sourceRow));
  const names = new Map(source.member.map((row) => [row.ownerRef, row.name]));
  const byRow = new Map(corrections.map(({ sourceRow, ...identity }) => [sourceRow, identity]));
  const financialByRow = new Map(kind === "member" ? [] :
    financialCorrections.map(({ sourceRow, fields }) => [sourceRow, ratFinancialFields[kind].parse(fields)]));
  return { units, products, offsets: accounts.map((a) => ({ id: a.id, name: accountName(a) })),
    rows: source[kind].map((r) => ({ sourceRow: r.sourceRow, reference: r.reference, name: names.get(r.ownerRef) ?? r.reference,
      value: r.value, notes: r.notes, published: published.has(r.sourceRow), correction: published.has(r.sourceRow) ? undefined : byRow.get(r.sourceRow),
      financialCorrection: published.has(r.sourceRow) ? undefined : financialByRow.get(r.sourceRow) })) };
}

type PlanRow = {
  sourceRow: number; name: string; action: string; memberId?: string; recordKey?: string; correctionRevision?: number;
  debit?: { id: string; code: string; name: string }; credit?: { id: string; code: string; name: string }; amount?: string;
};

async function plan(tx: TxClient, actor: Actor, input: Batch, source: Source, allowedUnits: string[]) {
  const { tenantId } = actor;
  const unit = await tx.cooperativeUnit.findFirst({ where: { tenantId, id: input.unitId, isActive: true, type: "KSP" }, select: { id: true, name: true } });
  if (!unit || !allowedUnits.includes(unit.id)) throw forbidden("Pilih unit simpan pinjam yang dapat Anda akses.");
  const keys = input.rows.map((r) => r.sourceRow);
  if (new Set(keys).size !== keys.length) throw validationError("Jangan pilih baris yang sama dua kali.");
  if (await tx.kopkarRatPublication.count({ where: { tenantId, kind: input.kind, sourceRow: { in: keys } } })) {
    throw conflict("Ada baris yang sudah diterbitkan. Muat ulang daftar.");
  }
  const rows: PlanRow[] = [];
  const sourceByRow = new Map(source[input.kind].map((r) => [r.sourceRow, r]));

  if (input.kind === "member") {
    const existing = await tx.member.findMany({
      where: { tenantId, OR: [{ memberId: { in: input.rows.flatMap((r) => r.action === "link" ? [r.memberId] : []) } },
        { nik: { in: input.rows.flatMap((r) => r.action === "create" ? [r.identity.nik] : [r.verifiedNik]) } }] },
      select: { id: true, memberId: true, nik: true, fullName: true, isActive: true }
    });
    const checked = checkVerifiedMemberBatch(input.rows, source.member.map((r) => ({ ...r, temporaryId: r.reference, fullName: r.name })), existing);
    if (!checked.canPublish) throw validationError("Perbaiki data anggota sebelum menerbitkan.", { issues: checked.issues });
    const corrections = await tx.kopkarRatMemberCorrection.findMany({ where: { tenantId, sourceRow: { in: keys } }, select: { sourceRow: true, revision: true } });
    const revisions = new Map(corrections.map((row) => [row.sourceRow, row.revision]));
    for (const item of input.rows) {
      const row = checked.rows.find((r) => r.sourceRow === item.sourceRow)!;
      const match = item.action === "link" ? existing.find((member) => member.memberId === item.memberId) : undefined;
      if (item.action === "link" && !match) rowError(item.sourceRow, "Gunakan ID anggota yang tertera di SISKOP.");
      if (match && !await tx.unitMembership.findFirst({ where: { memberId: match.id, unitId: unit.id } })) {
        rowError(item.sourceRow, "Anggota yang dipilih tidak terdaftar pada unit ini.");
      }
      const prior = match ? await tx.kopkarRatPublication.findFirst({
        where: { tenantId, kind: "member", recordKey: match.id }, select: { sourceRow: true }
      }) : null;
      if (prior) rowError(item.sourceRow, "Anggota ini sudah ditautkan dari baris arsip lain.");
      rows.push({ sourceRow: item.sourceRow, name: match?.fullName ?? row.fullName,
        action: match ? "Tautkan " + match.memberId + " · sumber: " + row.fullName : "Buat anggota aktif", memberId: match?.id,
        correctionRevision: revisions.get(item.sourceRow) ?? 0 });
    }
    return { unit, rows };
  }

  if (input.kind === "loan") await assertRatLoanPrincipalNotBooked(tx, tenantId, input.cutoffDate);
  if (input.cutoffDate > dateKey(businessDate())) throw validationError("Tanggal saldo awal tidak boleh di masa depan.");
  if (await tx.fiscalYearClose.findFirst({ where: { tenantId, year: Number(input.cutoffDate.slice(0, 4)), reopenedAt: null }, select: { id: true } })) {
    throw conflict("Tahun buku pada tanggal saldo awal sudah ditutup.");
  }
  const offset = await tx.account.findFirst({ where: { tenantId, id: input.offsetAccountId, ...offsets }, select: { id: true, code: true, name: true } });
  if (!offset) throw validationError("Pilih akun penampung neraca aktif selain kas/bank.");
  const ownerByRef = new Map(source.member.map((r) => [r.ownerRef, r]));
  const corrections = await tx.kopkarRatFinancialCorrection.findMany({ where: { tenantId, kind: input.kind, sourceRow: { in: keys } },
    select: { sourceRow: true, revision: true } });
  const revisions = new Map(corrections.map((row) => [row.sourceRow, row.revision]));
  const recordKeys = new Set<string>();
  const loanSignatures = new Set<string>();

  for (const item of input.rows) {
    const src = sourceByRow.get(item.sourceRow);
    const owner = src && ownerByRef.get(src.ownerRef);
    if (!owner) rowError(item.sourceRow, "Baris tidak memiliki referensi anggota yang cocok di arsip.");
    const publication = await tx.kopkarRatPublication.findFirst({
      where: { tenantId, kind: "member", sourceRow: owner.sourceRow }, select: { recordId: true }
    });
    const member = publication && await tx.member.findFirst({
      where: { tenantId, id: publication.recordId, isActive: true }, select: { id: true, fullName: true, memberId: true }
    });
    if (!member) rowError(item.sourceRow, "Terbitkan atau tautkan anggota pemilik saldo terlebih dahulu.");
    if (!await tx.unitMembership.findFirst({ where: { memberId: member.id, unitId: unit.id } })) {
      rowError(item.sourceRow, "Anggota pemilik saldo tidak terdaftar pada unit ini.");
    }
    const mappingType = input.kind === "saving" ? "SAVING_CONFIG" : "LOAN_CONFIG";
    const mappingKind = input.kind === "saving" ? "DEPOSIT" : "DISBURSEMENT";

    const mapping = await tx.accountMapping.findFirst({
      where: { tenantId, sourceType: mappingType, sourceId: item.productId, transactionKind: mappingKind },
      select: { debitAccountId: true, creditAccountId: true }
    });
    if (!mapping) rowError(item.sourceRow, "Lengkapi pemetaan akun produk terlebih dahulu.");
    const account = await tx.account.findFirst({
      where: { tenantId, id: input.kind === "saving" ? mapping.creditAccountId : mapping.debitAccountId,
        ...offsets, category: input.kind === "saving" ? { in: ["KEWAJIBAN", "EKUITAS"] } : "ASET" },
      select: { id: true, code: true, name: true }
    });
    if (!account || account.id === offset.id) rowError(item.sourceRow, "Akun produk harus aktif dan berbeda dari akun penampung.");

    let recordKey: string;
    let amount: string;
    let action: string;
    if ("balance" in item) {
      const product = await tx.savingConfig.findFirst({ where: { tenantId, id: item.productId, isActive: true }, select: { name: true } });
      if (!product) rowError(item.sourceRow, "Produk simpanan tidak aktif.");
      if (await tx.saving.findFirst({ where: { tenantId, memberId: member.id, savingConfigId: item.productId, unitId: unit.id }, select: { id: true } })) {
        rowError(item.sourceRow, "Rekening produk ini sudah ada. Rekonsiliasi di rekening yang ada.");
      }
      recordKey = [member.id, item.productId, unit.id].join(":");
      amount = D(item.balance).toFixed(2);
      action = "Saldo awal " + product.name;
    } else {
      const product = await tx.loanConfig.findFirst({ where: { tenantId, id: item.productId, isActive: true, installmentFrequency: "MONTHLY" }, select: { name: true } });
      if (!product) rowError(item.sourceRow, "Pilih produk pinjaman bulanan yang aktif.");
      validateLoanOpening(item, input.cutoffDate);
      const payments = await tx.accountMapping.findMany({
        where: { tenantId, sourceType: "LOAN_CONFIG", sourceId: item.productId, transactionKind: { in: ["PAYMENT_PRINCIPAL", "PAYMENT_INTEREST"] } },
        select: { transactionKind: true, creditAccountId: true }
      });
      if (!payments.some((m) => m.transactionKind === "PAYMENT_PRINCIPAL" && m.creditAccountId === account.id) ||
        (D(item.remainingAmount).gt(item.remainingPrincipal) && !payments.some((m) => m.transactionKind === "PAYMENT_INTEREST"))) {
        rowError(item.sourceRow, "Lengkapi pemetaan pembayaran pokok dan margin produk.");
      }
      const contractSignature = [member.id, D(item.principalAmount).toFixed(2), item.disbursedAt].join(":");
      if (loanSignatures.has(contractSignature) || await tx.loan.findFirst({ where: { tenantId, memberId: member.id, principalAmount: D(item.principalAmount), disbursedAt: { gte: startOfBusinessDay(parseDateKey(item.disbursedAt)), lte: endOfBusinessDay(parseDateKey(item.disbursedAt)) } }, select: { id: true } })) {
        rowError(item.sourceRow, "Pinjaman dengan anggota, pokok, dan tanggal cair yang sama sudah ada.");
      }
      loanSignatures.add(contractSignature);
      recordKey = item.contractRef.toUpperCase();
      amount = D(item.remainingPrincipal).toFixed(2);
      action = product.name + " · " + item.contractRef;
    }
    if (recordKeys.has(recordKey) || await tx.kopkarRatPublication.findFirst({
      where: { tenantId, kind: input.kind, recordKey }, select: { sourceRow: true }
    })) rowError(item.sourceRow, "Rekening atau nomor kontrak ini sudah dipilih atau diterbitkan.");
    recordKeys.add(recordKey);
    rows.push({ sourceRow: item.sourceRow, name: member.fullName + " · " + member.memberId, memberId: member.id, recordKey, amount, action, correctionRevision: revisions.get(item.sourceRow) ?? 0,
      debit: input.kind === "saving" ? offset : account, credit: input.kind === "saving" ? account : offset });
  }
  return { unit, rows };
}

export function validateLoanOpening(item: z.infer<typeof loan>, cutoffDate: string): void {
  const { sourceRow } = item;
  const nominal = D(item.principalAmount);
  const total = D(item.totalAmount);
  const outstanding = D(item.remainingPrincipal);
  const obligation = D(item.remainingAmount);
  if (item.disbursedAt > cutoffDate || total.lt(nominal) || outstanding.gt(nominal) || obligation.gt(total) ||
    obligation.lt(outstanding) || obligation.minus(outstanding).gt(total.minus(nominal))) {
    rowError(sourceRow, "Tanggal cair, pokok, margin, dan sisa kewajiban tidak cocok dengan kontrak.");
  }
  if (item.schedule.length > item.termMonths) rowError(sourceRow, "Jumlah cicilan tersisa melebihi tenor kontrak.");
  let previous = item.disbursedAt;
  let principalSum = D("0");
  let totalSum = D("0");
  for (const line of item.schedule) {
    const p = D(line.principal);
    const m = D(line.margin);
    if (line.dueDate <= previous || p.plus(m).lte(0)) rowError(sourceRow, "Urutkan tanggal jatuh tempo setelah tanggal cair; isi nilai cicilan yang positif.");
    principalSum = principalSum.plus(p);
    totalSum = totalSum.plus(p).plus(m);
    previous = line.dueDate;
  }
  if (!principalSum.eq(outstanding) || !totalSum.eq(obligation)) rowError(sourceRow, "Jumlah sisa jadwal harus sama dengan sisa pokok dan sisa kewajiban.");
  validateRegulatoryRate("LOAN", Number(item.rate));
}

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is required for archive publication previews");
  return value;
}
const audience = "kopkar-rat-publish";

export async function previewRatPublish(actor: Actor, input: Batch): Promise<RatPublishPreview> {
  assertScope(actor);
  const [source, units] = await Promise.all([loadRatPublishSource(), getEffectiveUnitIds(actor.userId, actor.tenantId)]);
  const planned = await db.$transaction((tx) => plan(tx, actor, input, source, units));
  const token = jwt.sign({ input: digest(input), plan: digest(planned) }, secret(), { audience, subject: actor.userId, expiresIn: "10m" });
  return { token, kind: input.kind, unit: planned.unit.name, cutoffDate: input.kind === "member" ? undefined : input.cutoffDate,
    rows: planned.rows.map((r) => ({ sourceRow: r.sourceRow, name: r.name, action: r.action,
      journal: r.debit && r.credit && r.amount && D(r.amount).gt(0) ? { debit: accountName(r.debit), credit: accountName(r.credit), amount: r.amount } : undefined })) };
}

export async function executeRatPublish(actor: Actor, input: Batch, token: string): Promise<RatPublishReceipt> {
  assertScope(actor);
  let claims: unknown;
  try { claims = jwt.verify(token, secret(), { algorithms: ["HS256"], audience, subject: actor.userId }); }
  catch { throw conflict("Pratinjau kedaluwarsa. Periksa ulang batch."); }
  const proof = z.object({ input: z.string(), plan: z.string() }).safeParse(claims);
  const batchHash = digest(input);
  if (!proof.success || proof.data.input !== batchHash) throw conflict("Isi batch berubah. Periksa ulang sebelum menerbitkan.");

  const { tenantId, userId } = actor;
  const [source, units] = await Promise.all([loadRatPublishSource(), getEffectiveUnitIds(userId, tenantId)]);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const previous = await tx.kopkarRatPublication.findMany({
      where: { tenantId, kind: input.kind, batchHash, publishedBy: userId, sourceRow: { in: input.rows.map((r) => r.sourceRow) } },
      orderBy: { sourceRow: "asc" }, select: { sourceRow: true, journalEntryNo: true }
    });
    if (previous.length === input.rows.length) return { rows: previous, alreadyPublished: true };
    const planned = await plan(tx, actor, input, source, units);
    if (proof.data.plan !== digest(planned)) throw conflict("Data tujuan berubah. Periksa ulang batch.");
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
    if (input.kind === "member") {
      const adding = input.rows.filter((r) => r.action === "create").length;
      if (adding) await assertQuota(tx, tenantId, "MEMBERS", { adding });
    }

    const rows: RatPublishReceipt["rows"] = [];
    for (const item of input.rows) {
      const p = planned.rows.find((r) => r.sourceRow === item.sourceRow)!;
      let recordId: string;
      let journalEntryNo: number | null = null;
      if ("action" in item) {
        if (item.action === "link") {
          recordId = p.memberId!;
        } else {
          const { birthDate, ...identity } = item.identity;
          const member = await tx.member.create({ data: {
            tenantId, ...identity, birthDate: parseDateKey(birthDate),
            memberId: await generateMemberId(tenantId, tenant.slug, tx), accountNumber: await generateAccountNumber(tx)
          }, select: { id: true } });
          recordId = member.id;
          await tx.unitMembership.create({ data: { memberId: recordId, unitId: input.unitId } });
        }
      } else if (input.kind !== "member") {
        const entryDate = parseDateKey(input.cutoffDate);
        let sourceId: string | null = null;
        const savingEntry = "balance" in item;
        if (savingEntry) {
          const balance = D(item.balance);
          const savingRecord = await tx.saving.create({ data: { tenantId, unitId: input.unitId, memberId: p.memberId!, savingConfigId: item.productId, balance }, select: { id: true } });
          recordId = savingRecord.id;
          if (balance.gt(0)) sourceId = (await tx.savingTransaction.create({
            data: { tenantId, savingId: recordId, type: "DEPOSIT", amount: balance, createdBy: userId, createdAt: entryDate, note: "Saldo awal RAT 2025 (tanpa kas)" }, select: { id: true }
          })).id;
        } else {
          const first = item.schedule[0]!;
          const last = item.schedule[item.schedule.length - 1]!;
          const overdue = Math.max(0, Math.floor((businessDate().getTime() - parseDateKey(first.dueDate).getTime()) / 86400000));
          const loanRecord = await tx.loan.create({ data: {
            tenantId, unitId: input.unitId, memberId: p.memberId!, loanConfigId: item.productId,
            principalAmount: D(item.principalAmount), totalAmount: D(item.totalAmount), remainingAmount: D(item.remainingAmount),
            termMonths: item.termMonths, monthlyPayment: D(item.installmentAmount), installmentAmount: D(item.installmentAmount),
            disbursedAt: parseDateKey(item.disbursedAt), maturityDate: parseDateKey(last.dueDate),
            kolCategory: getKOLCategory(overdue), daysOverdue: overdue, rate: D(item.rate),
            rateNote: "Tarif kontrak yang diverifikasi", notes: "Saldo awal RAT 2025 · Kontrak " + item.contractRef
          }, select: { id: true } });
          recordId = loanRecord.id;
          sourceId = recordId;
          await tx.loanInstallment.createMany({ data: item.schedule.map((line, i) => ({
            tenantId, loanId: recordId, seq: i + 1, dueDate: parseDateKey(line.dueDate),
            principalDue: D(line.principal), interestDue: D(line.margin)
          })) });
        }
        if (sourceId) {
          const entry = await createJournalEntry(tx, { tenantId, unitId: input.unitId, entryDate,
            sourceType: savingEntry ? "SAVING_TRANSACTION" : "LOAN_DISBURSEMENT", sourceId,
            entryType: "PENYESUAIAN", createdById: userId, description: "Saldo awal RAT 2025 (tanpa kas) · baris " + item.sourceRow,
            lines: [{ accountId: p.debit!.id, debit: D(p.amount!) }, { accountId: p.credit!.id, credit: D(p.amount!) }] });
          journalEntryNo = entry.entryNo;
        }
      } else throw new Error("Invalid RAT publication mode");

      await tx.kopkarRatPublication.create({ data: {
        tenantId, kind: input.kind, sourceRow: item.sourceRow, recordId, recordKey: p.recordKey ?? recordId,
        publishedBy: userId, batchHash, journalEntryNo, verificationRef: input.kind === "member" ? null : input.verificationRef
      } });
      rows.push({ sourceRow: item.sourceRow, journalEntryNo });
    }
    await recordAudit(tx, { action: "rat.publish", entityType: "KopkarRatPublication", entityId: batchHash, after: {
      kind: input.kind, unitId: input.unitId, rows,
      ...(input.kind === "member" ? {} : { cutoffDate: input.cutoffDate, offsetAccountId: input.offsetAccountId, verificationRef: input.verificationRef })
    } });
    return { rows, alreadyPublished: false };
  }, { isolationLevel: "Serializable", timeout: 30000 }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      throw conflict("Data berubah saat batch diterbitkan. Coba lagi atau periksa ulang.");
    }
    throw error;
  });
}
