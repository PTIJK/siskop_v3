import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { KOPKAR_RAT_TENANT_ID } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, forbidden } from "../../lib/errors.js";
import { generateAccountNumbers } from "../../lib/id-generator.js";
import { parseDateKey } from "../../lib/operating-calendar.js";
import { assertQuota } from "../../lib/pricing/entitlements.js";
import { getEffectiveUnitIds } from "../../lib/unit-access.js";
import { recordAudit } from "../audit-log/service.js";
import { listProvisionalKopkarMembers } from "./kopkar-rat.js";

export async function activateKopkarTmpMembers(tenantId: string, userId: string, expectedCount: number) {
  if (tenantId !== KOPKAR_RAT_TENANT_ID) throw forbidden("Aktivasi ini khusus Kopkar UM Surabaya.");
  const allowedUnits = await getEffectiveUnitIds(userId, tenantId);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    const drafts = await listProvisionalKopkarMembers(tenantId, tx);
    if (!drafts.length) return { activated: 0, needsMatch: 0 };
    if (drafts.length !== expectedCount) throw conflict("Jumlah baris berubah. Muat ulang daftar dan periksa kembali.");

    const units = await tx.cooperativeUnit.findMany({
      where: { tenantId, id: { in: allowedUnits }, isActive: true, type: "KSP" }, take: 2, select: { id: true }
    });
    if (units.length !== 1) throw conflict("Aktivasi ini membutuhkan satu unit simpan pinjam yang aktif.");
    const unitId = units[0]!.id;
    const current = await tx.member.findMany({ where: { tenantId }, select: { fullName: true } });
    const normalize = (name: string) => name.trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
    const existingNames = new Set(current.map(({ fullName }) => normalize(fullName)));
    const members = drafts.filter(({ fullName }) => !existingNames.has(normalize(fullName)));
    const needsMatch = drafts.length - members.length;
    if (!members.length) return { activated: 0, needsMatch };
    await assertQuota(tx, tenantId, "MEMBERS", { adding: members.length });
    const accountNumbers = await generateAccountNumbers(tx, members.length);
    const created = await tx.member.createManyAndReturn({
      data: members.map((member, index) => ({
        tenantId, memberId: member.temporaryId, accountNumber: accountNumbers[index]!, fullName: member.fullName,
        nik: member.nik, birthDate: member.birthDate ? parseDateKey(member.birthDate) : null,
        address: member.address ?? "", birthPlace: member.birthPlace ?? "", occupation: member.occupation ?? "",
        isActive: true, identityUnverified: true
      })),
      select: { id: true, memberId: true }
    });
    await tx.unitMembership.createMany({ data: created.map(({ id }) => ({ memberId: id, unitId })) });
    const recordIds = new Map(created.map(({ id, memberId }) => [memberId, id]));
    const batchHash = randomUUID();
    await tx.kopkarRatPublication.createMany({ data: members.map(({ temporaryId, sourceRow }) => {
      const recordId = recordIds.get(temporaryId)!;
      return { tenantId, kind: "member", sourceRow, recordId, recordKey: recordId, publishedBy: userId, batchHash };
    }) });
    await recordAudit(tx, { action: "rat.activate_tmp_members", entityType: "KopkarRatPublication", entityId: batchHash,
      after: { unitId, activated: created.length, needsMatch } });
    return { activated: created.length, needsMatch };
  }, { timeout: 30000 }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      throw conflict("Ada data anggota yang sama atau berubah. Periksa data sebelum mengulangi aktivasi.");
    }
    throw error;
  });
}
