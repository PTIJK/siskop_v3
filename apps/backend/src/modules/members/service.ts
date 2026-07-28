import type { Prisma } from "@prisma/client";
import { ErrorCode } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { generateAccountNumber, generateMemberId } from "../../lib/id-generator.js";
import { getDefaultUnitId } from "../../lib/units.js";
import type { CreateMemberInput, ListMembersQueryInput, UpdateMemberInput } from "./schema.js";

export async function listMembers(tenantId: string, query: ListMembersQueryInput) {
  const { page, limit, search, sortBy, sortOrder, isActive } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.MemberWhereInput = {
    tenantId,
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { nik: { contains: search } },
            { memberId: { contains: search, mode: "insensitive" } },
            { accountNumber: { contains: search } }
          ]
        }
      : {}),
    ...(isActive !== undefined ? { isActive } : {})
  };

  const [items, total] = await Promise.all([
    db.member.findMany({ where, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
    db.member.count({ where })
  ]);

  return { items, meta: { page, limit, total } };
}

export async function getMemberById(tenantId: string, id: string) {
  const member = await db.member.findFirst({
    where: { id, tenantId },
    include: {
      savings: { where: { isActive: true }, include: { savingConfig: true } },
      loans: {
        where: { status: { in: ["ACTIVE", "PENDING"] } },
        include: { loanConfig: true },
        take: 1,
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!member) throw notFound("Anggota tidak ditemukan");
  return member;
}

export async function createMember(tenantId: string, data: CreateMemberInput) {
  const duplicateNik = await db.member.findFirst({ where: { tenantId, nik: data.nik } });
  if (duplicateNik) throw new AppError(ErrorCode.NIK_EXISTS, "NIK sudah terdaftar di koperasi ini");

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const [memberId, accountNumber, unitId] = await Promise.all([
    generateMemberId(tenantId, tenant.slug),
    generateAccountNumber(),
    getDefaultUnitId(tenantId)
  ]);

  return db.$transaction(async (tx) => {
    const member = await tx.member.create({
      data: {
        tenantId,
        memberId,
        accountNumber,
        fullName: data.fullName,
        nik: data.nik,
        address: data.address,
        birthPlace: data.birthPlace,
        birthDate: new Date(data.birthDate),
        occupation: data.occupation,
        isActive: true
      }
    });

    // Auto-enrolled into the tenant's sole unit — no picker UI in Phase 1
    // (CLAUDE.md rule 2b / merge plan "unit scoping").
    await tx.unitMembership.create({ data: { memberId: member.id, unitId } });

    return member;
  });
}

export async function updateMember(tenantId: string, id: string, data: UpdateMemberInput) {
  const member = await db.member.findFirst({ where: { id, tenantId } });
  if (!member) throw notFound("Anggota tidak ditemukan");

  if (data.nik && data.nik !== member.nik) {
    const duplicateNik = await db.member.findFirst({ where: { tenantId, nik: data.nik } });
    if (duplicateNik) throw new AppError(ErrorCode.NIK_EXISTS, "NIK sudah terdaftar di koperasi ini");
  }

  return db.member.update({
    where: { id },
    data: {
      ...(data.fullName && { fullName: data.fullName }),
      ...(data.nik && { nik: data.nik }),
      ...(data.address && { address: data.address }),
      ...(data.birthPlace && { birthPlace: data.birthPlace }),
      ...(data.birthDate && { birthDate: new Date(data.birthDate) }),
      ...(data.occupation && { occupation: data.occupation })
    }
  });
}

export async function deactivateMember(tenantId: string, id: string): Promise<void> {
  const member = await db.member.findFirst({ where: { id, tenantId } });
  if (!member) throw notFound("Anggota tidak ditemukan");

  await db.member.update({ where: { id }, data: { isActive: false } });
}

export async function uploadMemberKtp(tenantId: string, id: string, filePath: string) {
  const member = await db.member.findFirst({ where: { id, tenantId } });
  if (!member) throw notFound("Anggota tidak ditemukan");

  return db.member.update({ where: { id }, data: { ktpPhotoUrl: filePath } });
}
