import { db } from "../../lib/db.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { verifyFirebaseIdentity } from "../onboarding/firebase.js";
import { centralUrl } from "./config.js";
import { digest, secretValue } from "./service.js";
import type { MembershipInvitationResponse } from "@siskop/types";

export async function inviteMembership(tenantId: string, membershipId: string): Promise<MembershipInvitationResponse> {
  const user = await db.user.findFirst({ where: { tenantId, id: membershipId } });
  if (!user) throw notFound("Pengguna tidak ditemukan.");
  if (user.identityId || user.isPlatformAdmin) throw conflict("Akun sudah terhubung atau bukan akun koperasi.");
  const token = secretValue(), expiresAt = new Date(Date.now() + 48 * 3600_000);
  await db.$transaction(async tx => {
    await tx.membershipInvitation.updateMany({ where: { membershipId, acceptedAt: null }, data: { expiresAt: new Date() } });
    await tx.membershipInvitation.create({ data: { membershipId, tokenHash: digest(token), email: user.email.toLowerCase(), expiresAt } });
  });
  return { invitationUrl: centralUrl(`/invite#token=${token}`), expiresAt: expiresAt.toISOString() };
}
export async function acceptInvitation(token: string, idToken: string) {
  const proof = await verifyFirebaseIdentity(idToken);
  // Verify the intended recipient through the provider; email alone never links.
  if (!proof.emailVerified) throw forbidden("Verifikasi alamat email Anda sebelum menerima undangan.");
  const invitation = await db.membershipInvitation.findUnique({ where: { tokenHash: digest(token) }, include: { membership: { include: { tenant: true } } } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) throw forbidden("Undangan tidak valid atau kedaluwarsa.");
  if (invitation.email !== proof.email || invitation.membership.email.toLowerCase() !== proof.email || !invitation.membership.tenant.isActive || invitation.membership.identityId || invitation.membership.isPlatformAdmin) throw forbidden("Undangan bukan untuk akun ini.");
  await db.$transaction(async tx => {
    const identity = await tx.accountIdentity.upsert({ where: { firebaseUid: proof.uid }, update: {}, create: { firebaseUid: proof.uid } });
    if (!identity.isActive) throw forbidden("Akun tidak aktif.");
    const existing = await tx.user.findUnique({ where: { identityId_tenantId: { identityId: identity.id, tenantId: invitation.membership.tenantId } } });
    if (existing) throw conflict("Akun ini sudah memiliki keanggotaan di koperasi tersebut.");
    const used = await tx.membershipInvitation.updateMany({ where: { id: invitation.id, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
    if (used.count !== 1) throw forbidden("Undangan sudah digunakan.");
    const linked = await tx.user.updateMany({ where: { id: invitation.membershipId, tenantId: invitation.membership.tenantId, identityId: null, email: invitation.membership.email, isPlatformAdmin: false, tenant: { isActive: true } }, data: { identityId: identity.id, isActive: true, passwordHash: null, authProvider: proof.provider } });
    if (linked.count !== 1) throw conflict("Keanggotaan berubah. Minta undangan baru.");
  }).catch((err: unknown) => {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") throw conflict("Akun ini sudah memiliki keanggotaan di koperasi tersebut.");
    throw err;
  });
  return { tenantName: invitation.membership.tenant.name, loginUrl: centralUrl() };
}
