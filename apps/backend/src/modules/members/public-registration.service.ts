import { saveKtp } from "../../lib/upload-storage.js";
import { db } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import { tenantHasFeature } from "../../lib/pricing/entitlements.js";
import type { SniffedFileType } from "../../lib/file-sniff.js";
import { createTenantNotification } from "../notifications/service.js";
import type { SubmitRegistrationInput } from "./public-registration.schema.js";

export interface KtpUpload {
  buffer: Buffer;
  type: SniffedFileType;
}

interface SubmitResult {
  message: string;
  nikMasked: string;
  nikWarning: boolean;
}

/**
 * Resolves :tenantSlug to a tenant id, only if the tenant is active AND has
 * self-registration turned on — collapses "no such tenant" and "disabled"
 * into a single null so the route can 404 both identically, revealing
 * neither. Distinct from getPublicTenantBranding below, which the closed-
 * state page needs to still show the tenant's name/logo for.
 */
export async function resolveRegistrableTenant(tenantSlug: string): Promise<{ id: string } | null> {
  const tenant = await db.tenant.findFirst({
    where: { slug: tenantSlug, isActive: true, selfRegistrationEnabled: true },
    select: { id: true }
  });
  // A package without self_registration closes the page exactly like the switch does.
  if (tenant && !(await tenantHasFeature(tenant.id, "self_registration"))) return null;
  return tenant;
}

export async function getPublicTenantBranding(tenantSlug: string) {
  const tenant = await db.tenant.findFirst({
    where: { slug: tenantSlug, isActive: true },
    select: { id: true, name: true, logoUrl: true, selfRegistrationEnabled: true }
  });
  if (!tenant) throw notFound("Pendaftaran tidak ditemukan");

  return {
    tenantName: tenant.name,
    tenantLogoUrl: tenant.logoUrl,
    selfRegistrationEnabled: tenant.selfRegistrationEnabled && (await tenantHasFeature(tenant.id, "self_registration"))
  };
}

function maskNik(nik: string): string {
  return "*".repeat(Math.max(0, nik.length - 4)) + nik.slice(-4);
}

/**
 * The unauthenticated write path. Never writes to Member — only to
 * MemberRegistrationRequest (PENDING), reviewed later through
 * modules/members/registration.service.ts#approveRegistrationRequest.
 */
export async function submitPublicRegistration(
  tenantId: string,
  data: SubmitRegistrationInput,
  ktp?: KtpUpload
): Promise<SubmitResult> {
  const [existingMember, existingPending] = await Promise.all([
    db.member.findFirst({ where: { tenantId, nik: data.nik }, select: { id: true } }),
    db.memberRegistrationRequest.findFirst({
      where: { tenantId, nik: data.nik, status: "PENDING" },
      select: { id: true }
    })
  ]);
  const nikWarning = !!existingMember || !!existingPending;

  const ktpPhotoUrl = ktp ? await saveKtp(tenantId, ktp.buffer) : undefined;

  await db.$transaction(async (tx) => {
    const created = await tx.memberRegistrationRequest.create({
      data: {
        tenantId,
        fullName: data.fullName,
        nik: data.nik,
        address: data.address,
        birthPlace: data.birthPlace,
        birthDate: new Date(data.birthDate),
        occupation: data.occupation,
        phone: data.phone,
        ktpPhotoUrl
      }
    });

    const pendingCount = await tx.memberRegistrationRequest.count({ where: { tenantId, status: "PENDING" } });
    await createTenantNotification(tx, {
      tenantId,
      type: "MEMBER_REGISTRATION_PENDING",
      title: "Pendaftaran mandiri baru",
      message: `${pendingCount} pendaftaran mandiri menunggu persetujuan`,
      permissionModule: "members",
      permissionAction: "create",
      relatedId: created.id
    });
  });

  return {
    message: "Pendaftaran Anda sedang diproses, silakan tunggu konfirmasi dari petugas.",
    nikMasked: maskNik(data.nik),
    nikWarning
  };
}
