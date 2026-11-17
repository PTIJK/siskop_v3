import type { RatFinancialDirectory, RatFinancialKind } from "@siskop/types";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { dateKey, parseDateKey } from "../../lib/operating-calendar.js";
import { recordAudit } from "../audit-log/service.js";
import { loadRatPublishSource } from "./kopkar-rat.js";

export const ratFinancialKind = z.enum(["saving", "loan"]);
const money = z.string().trim().regex(/^-?\d{1,13}(?:\.\d{1,2})?$/, "Gunakan angka tanpa pemisah ribuan, maksimal 2 desimal");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = parseDateKey(value);
  return Number.isFinite(parsed.valueOf()) && dateKey(parsed) === value;
}, "Tanggal tidak valid");
const blank = z.literal("");
const productId = z.string().trim().max(64).optional();
const note = z.string().trim().max(1000).optional();
const amount = money.or(blank).optional();

export const ratFinancialFields = {
  saving: z.object({ productId, balance: amount, reviewNote: note }).strict(),
  loan: z.object({
    productId, contractRef: z.string().trim().max(64).optional(), disbursedAt: date.or(blank).optional(),
    principalAmount: amount, totalAmount: amount, remainingPrincipal: amount, remainingAmount: amount,
    termMonths: z.string().regex(/^([1-9]\d{0,2})?$/).optional(), rate: z.string().trim().regex(/^(\d{1,3}(?:\.\d{1,4})?)?$/).optional(),
    installmentAmount: amount, schedule: z.string().trim().max(20000).optional(), reviewNote: note
  }).strict()
};

export async function listRatFinancialDrafts(tenantId: string, kind: RatFinancialKind): Promise<RatFinancialDirectory> {
  const [source, publications, corrections, products] = await Promise.all([
    loadRatPublishSource(),
    db.kopkarRatPublication.findMany({ where: { tenantId, kind }, select: { sourceRow: true } }),
    db.kopkarRatFinancialCorrection.findMany({ where: { tenantId, kind }, select: { sourceRow: true, fields: true, revision: true } }),
    kind === "saving"
      ? db.savingConfig.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, type: true } })
      : db.loanConfig.findMany({ where: { tenantId, isActive: true, installmentFrequency: "MONTHLY" }, select: { id: true, name: true, type: true } })
  ]);
  const published = new Set(publications.map(({ sourceRow }) => sourceRow));
  const byRow = new Map(corrections.map((correction) => [correction.sourceRow, correction]));
  const names = new Map(source.member.map((row) => [row.ownerRef, row.name]));
  return { products, rows: source[kind].filter((row) => !published.has(row.sourceRow)).map(({ value: _value, ...row }) => {
    const correction = byRow.get(row.sourceRow);
    return { ...row, name: names.get(row.ownerRef) ?? row.ownerRef,
      ownerRef: /^SRC-\d+$/.test(row.ownerRef) ? "TMP-" + row.ownerRef : row.ownerRef,
      fields: correction ? ratFinancialFields[kind].parse(correction.fields) : {},
      revision: correction?.revision ?? 0 };
  }) };
}

export async function saveRatFinancialDraft(
  tenantId: string, actorId: string, kind: RatFinancialKind, sourceRow: number, revision: number, fields: Record<string, string>
) {
  const source = await loadRatPublishSource();
  if (!source[kind].some((row) => row.sourceRow === sourceRow)) throw notFound("Baris arsip tidak ditemukan.");
  return db.$transaction(async (tx) => {
    // Use the same lock as posting so a concurrent correction cannot change a published row.
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const where = { tenantId_kind_sourceRow: { tenantId, kind, sourceRow } };
    if (await tx.kopkarRatPublication.findUnique({ where, select: { sourceRow: true } })) throw conflict("Baris ini sudah diterbitkan.");
    const current = await tx.kopkarRatFinancialCorrection.findUnique({ where, select: { revision: true } });
    if ((current?.revision ?? 0) !== revision) throw conflict("Koreksi sudah berubah. Tutup dan buka kembali baris ini.");
    if (fields.productId) {
      const product = { tenantId, id: fields.productId, isActive: true };
      const found = kind === "saving" ? await tx.savingConfig.count({ where: product })
        : await tx.loanConfig.count({ where: { ...product, installmentFrequency: "MONTHLY" } });
      if (!found) throw validationError("Pilih produk aktif yang tersedia.");
    }
    const updated = { fields, revision: revision + 1, updatedBy: actorId };
    await tx.kopkarRatFinancialCorrection.upsert({ where, create: { tenantId, kind, sourceRow, ...updated }, update: updated });
    await recordAudit(tx, { action: "rat.finance_corrected", entityType: "KopkarRatFinancialCorrection", entityId: kind + ":" + sourceRow,
      after: { kind, sourceRow, revision: updated.revision } });
    return { fields, revision: updated.revision };
  });
}
