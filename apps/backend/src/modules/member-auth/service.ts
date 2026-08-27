import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { MemberAuthClaims, MemberProfile } from "@siskop/types";
import { db } from "../../lib/db.js";
import { unauthorized, notFound, validationError } from "../../lib/errors.js";
import { signMemberAccessToken } from "../../middleware/member-auth.js";
import { slugFromHost } from "../auth/tenant-host.js";

const BCRYPT_ROUNDS = 10;

type Session = { accessToken: string; refreshToken: string; member: MemberProfile };
type RefreshedSession = { accessToken: string; refreshToken: string };

function secret(name: "JWT_SECRET" | "JWT_REFRESH_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/** `DDMMYYYY` from the member's own birthDate — UTC parts, since Prisma stores date-only values at UTC midnight. */
export function defaultPasswordFromBirthDate(birthDate: Date): string {
  const day = String(birthDate.getUTCDate()).padStart(2, "0");
  const month = String(birthDate.getUTCMonth() + 1).padStart(2, "0");
  const year = String(birthDate.getUTCFullYear());
  return `${day}${month}${year}`;
}

function toProfile(member: { id: string; memberId: string; accountNumber: string; fullName: string; mustChangePassword: boolean }): MemberProfile {
  return {
    id: member.id,
    memberId: member.memberId,
    accountNumber: member.accountNumber,
    fullName: member.fullName,
    mustChangePassword: member.mustChangePassword
  };
}

function issue(claims: MemberAuthClaims): { accessToken: string; refreshToken: string } {
  return {
    accessToken: signMemberAccessToken(claims, secret("JWT_SECRET"), process.env.JWT_EXPIRES_IN ?? "15m"),
    refreshToken: jwt.sign(
      { memberId: claims.memberId, tenantId: claims.tenantId, typ: "member_refresh" },
      secret("JWT_REFRESH_SECRET"),
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d" } as jwt.SignOptions
    )
  };
}

/**
 * Staff-invoked, not member-invoked: there is no member self-registration.
 * Idempotent, so the same action serves as both first activation and a
 * "forgot password" reset — always resets back to the birthdate default.
 */
export async function activatePortalAccess(
  tenantId: string,
  memberId: string
): Promise<{ defaultPassword: string }> {
  const member = await db.member.findFirst({ where: { id: memberId, tenantId } });
  if (!member) throw notFound("Anggota tidak ditemukan");

  const defaultPassword = defaultPasswordFromBirthDate(member.birthDate);
  const passwordHash = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);

  await db.member.update({
    where: { id: memberId, tenantId },
    data: { passwordHash, mustChangePassword: true }
  });

  return { defaultPassword };
}

export async function loginMember(host: string | undefined, nik: string, password: string): Promise<Session> {
  const slug = slugFromHost(host);
  if (!slug) {
    throw validationError("Cooperative not identified — use your cooperative's subdomain");
  }

  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant || !tenant.isActive) throw unauthorized("Cooperative not found or inactive");

  const member = await db.member.findUnique({ where: { tenantId_nik: { tenantId: tenant.id, nik } } });

  // Hash a throwaway when the member is absent, or portal access was never
  // activated, so the response time does not reveal which case applies.
  const hash = member?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
  const ok = await bcrypt.compare(password, hash);

  if (!member || !ok || !member.isActive || !member.passwordHash) throw unauthorized();

  const claims: MemberAuthClaims = { memberId: member.id, tenantId: member.tenantId, role: "member" };
  await db.member.update({ where: { id: member.id, tenantId: member.tenantId }, data: { lastLoginAt: new Date() } });

  return { ...issue(claims), member: toProfile(member) };
}

export async function refreshMemberSession(token: string): Promise<RefreshedSession> {
  let payload: unknown;
  try {
    payload = jwt.verify(token, secret("JWT_REFRESH_SECRET"));
  } catch {
    throw unauthorized("Invalid or expired refresh token");
  }

  const parsed = z
    .object({ memberId: z.string().min(1), typ: z.literal("member_refresh") })
    .safeParse(payload);
  if (!parsed.success) throw unauthorized("Invalid or expired refresh token");

  const member = await db.member.findUnique({ where: { id: parsed.data.memberId } });
  if (!member || !member.isActive || !member.passwordHash) throw unauthorized("Invalid or expired refresh token");

  const tenant = await db.tenant.findUnique({ where: { id: member.tenantId } });
  if (!tenant?.isActive) throw unauthorized("Invalid or expired refresh token");

  const claims: MemberAuthClaims = { memberId: member.id, tenantId: member.tenantId, role: "member" };
  return issue(claims);
}

export async function getMemberProfile(memberId: string, tenantId: string): Promise<MemberProfile> {
  const member = await db.member.findFirst({ where: { id: memberId, tenantId } });
  if (!member) throw unauthorized();
  return toProfile(member);
}

export async function changeMemberPassword(
  memberId: string,
  tenantId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const member = await db.member.findFirst({ where: { id: memberId, tenantId } });
  if (!member || !member.passwordHash) throw unauthorized();

  const ok = await bcrypt.compare(currentPassword, member.passwordHash);
  if (!ok) throw unauthorized("Password saat ini salah");

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.member.update({
    where: { id: memberId, tenantId },
    data: { passwordHash, mustChangePassword: false }
  });
}
