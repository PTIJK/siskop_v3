import type { Prisma } from "@prisma/client";
import { ErrorCode } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { generateAccountNumber, generateMemberId } from "../../lib/id-generator.js";
import { getDefaultUnitId } from "../../lib/units.js";
import type { ListRegistrationRequestsQueryInput, RejectRegistrationRequestInput } from "./registration.schema.js";

const registrationRequestSelect = {
  id: true,
  tenantId: true,
  fullName: true,
  nik: true,
  address: true,
  birthPlace: true,
  birthDate: true,
  occupation: true,
  phone: true,
  ktpPhotoUrl: true,
  status: true,
  rejectionReason: true,
  submittedAt: true,
  reviewedAt: true,
  reviewedByUserId: true,
  createdMemberId: true
} satisfies Prisma.MemberRegistrationRequestSelect;

/** The public URL a QR code encodes. Path-based on the app's base domain (not
 * the tenant's subdomain) — see modules/members/public-registration.routes.ts,
 * which resolves the tenant from this same :tenantSlug segment, not Host. */
export async function getSelfRegistrationLink(tenantId: string): Promise<{ url: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  if (!tenant) throw notFound("Tenant tidak ditemukan");

  const base = (process.env.PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return { url: `${base}/daftar/${tenant.slug}` };
}

export async function listRegistrationRequests(tenantId: string, query: ListRegistrationRequestsQueryInput) {
  const { page, limit, status } = query;
  const skip = (page - 1) * limit;
  const where: Prisma.MemberRegistrationRequestWhereInput = { tenantId, status };

  const [items, total] = await Promise.all([
    db.memberRegistrationRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { submittedAt: "desc" },
      select: registrationRequestSelect
    }),
    db.memberRegistrationRequest.count({ where })
  ]);

  return { items, meta: { page, limit, total } };
}

async function getPendingRequest(tenantId: string, id: string) {
  const request = await db.memberRegistrationRequest.findFirst({ where: { id, tenantId } });
  if (!request) throw notFound("Pendaftaran tidak ditemukan");
  if (request.status !== "PENDING") throw conflict("Pendaftaran ini sudah ditinjau");
  return request;
}

/**
 * Creates the Member exactly as a teller would (same generateMemberId()/
 * generateAccountNumber() calls, same default-unit enrollment as
 * members/service.ts#createMember), then marks the request APPROVED in the
 * same transaction — a request must never be left PENDING after its Member
 * already exists. Deliberately not calling createMember() directly: that
 * function opens its own transaction, and approving a request needs the
 * member insert and the request's status update to commit together.
 */
export async function approveRegistrationRequest(tenantId: string, id: string, reviewerUserId: string) {
  const request = await getPendingRequest(tenantId, id);

  const duplicateNik = await db.member.findFirst({ where: { tenantId, nik: request.nik } });
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
        fullName: request.fullName,
        nik: request.nik,
        address: request.address,
        birthPlace: request.birthPlace,
        birthDate: request.birthDate,
        occupation: request.occupation,
        ktpPhotoUrl: request.ktpPhotoUrl,
        isActive: true,
        isPengurus: false,
        isPengawas: false
      }
    });

    await tx.unitMembership.create({ data: { memberId: member.id, unitId } });

    await tx.memberRegistrationRequest.update({
      where: { id: request.id, tenantId },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedByUserId: reviewerUserId,
        createdMemberId: member.id
      }
    });

    return member;
  });
}

export async function rejectRegistrationRequest(
  tenantId: string,
  id: string,
  reviewerUserId: string,
  data: RejectRegistrationRequestInput
) {
  await getPendingRequest(tenantId, id);

  return db.memberRegistrationRequest.update({
    where: { id, tenantId },
    data: {
      status: "REJECTED",
      rejectionReason: data.rejectionReason,
      reviewedAt: new Date(),
      reviewedByUserId: reviewerUserId
    },
    select: registrationRequestSelect
  });
}
