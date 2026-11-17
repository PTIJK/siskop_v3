import { KOPKAR_RAT_TENANT_ID, type ProvisionalMember } from "@siskop/types";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { businessDate, dateKey, parseDateKey } from "../../lib/operating-calendar.js";
import { recordAudit } from "../audit-log/service.js";
import { listProvisionalKopkarMembers } from "../migration/kopkar-rat.js";

const birthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = parseDateKey(value);
  return Number.isFinite(date.valueOf()) && dateKey(date) === value && date <= businessDate();
}, "Tanggal lahir tidak valid");

export const provisionalCorrectionSchema = z.object({
  revision: z.number().int().min(0),
  fullName: z.string().trim().min(2).max(200),
  nik: z.string().trim().regex(/^\d{16}$/, "NIK harus 16 digit atau dikosongkan").nullable(),
  address: z.string().trim().min(1).max(500).nullable(),
  birthPlace: z.string().trim().min(1).max(120).nullable(),
  birthDate: birthDate.nullable(),
  occupation: z.string().trim().min(1).max(120).nullable()
}).strict();

export async function saveProvisionalCorrection(
  tenantId: string, actorId: string, sourceRow: number, input: z.infer<typeof provisionalCorrectionSchema>
): Promise<ProvisionalMember> {
  if (tenantId !== KOPKAR_RAT_TENANT_ID) throw forbidden("Arsip anggota ini hanya tersedia di Kopkar UM Surabaya.");
  const source = (await listProvisionalKopkarMembers(tenantId)).find((member) => member.sourceRow === sourceRow);
  if (!source) throw notFound("Baris anggota belum terverifikasi tidak ditemukan.");

  const { revision, ...fields } = input;
  return db.$transaction(async (tx) => {
    // Serialize with publishing so a draft cannot be changed after its live row is created.
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const published = await tx.kopkarRatPublication.findFirst({ where: { tenantId, kind: "member", sourceRow }, select: { sourceRow: true } });
    if (published) throw conflict("Anggota ini sudah diterbitkan. Buka data anggota aktif.");
    const current = await tx.kopkarRatMemberCorrection.findFirst({ where: { tenantId, sourceRow }, select: { revision: true } });
    if ((current?.revision ?? 0) !== revision) throw conflict("Koreksi sudah berubah. Tutup dan buka kembali baris ini.");

    const updated = { ...fields, revision: revision + 1, updatedBy: actorId };
    await tx.kopkarRatMemberCorrection.upsert({
      where: { tenantId_sourceRow: { tenantId, sourceRow } },
      create: { tenantId, sourceRow, ...updated },
      update: updated
    });
    await recordAudit(tx, { action: "rat.member_corrected", entityType: "KopkarRatMemberCorrection", entityId: String(sourceRow),
      after: { sourceRow, revision: updated.revision } });
    return { ...source, ...fields, revision: updated.revision };
  });
}
