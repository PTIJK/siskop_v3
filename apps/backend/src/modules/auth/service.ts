import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  CooperativeType,
  type AuthClaims,
  type LoginResponse,
  type Permissions,
  type RefreshResponse,
  type User
} from "@siskop/types";
import { db } from "../../lib/db.js";
import { provisionTenantInTx, slugSchema } from "../tenants/provision.js";
import { signAccessToken } from "../../middleware/auth.js";
import { unauthorized, conflict, validationError } from "../../lib/errors.js";
import { deriveUserRole, toPublicUser, type UserWithRole } from "../../lib/user-mapper.js";

import { assertFirebaseSession } from "../onboarding/firebase.js";

const BCRYPT_ROUNDS = 10;

// The wire types (LoginResponse/RefreshResponse) omit the refresh token — it
// travels only in an httpOnly cookie set by the route layer. Service
// functions still need to hand that token to the route to put in the cookie,
// so they return this superset; routes.ts strips `refreshToken` back out
// before the response body is built.
type Session = LoginResponse & { refreshToken: string };
type RefreshedSession = RefreshResponse & { refreshToken: string };

const registerSchema = z.object({
  tenantName: z.string().min(1),
  slug: slugSchema,
  registrationNo: z.string().min(1),
  address: z.string().min(1),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
  firstUnit: z.object({ type: z.nativeEnum(CooperativeType), name: z.string().min(1) })
});

export type RegisterTenantInput = z.input<typeof registerSchema>;

/** Secrets are never defaulted: signing with "" would produce forgeable tokens. */
function secret(name: "JWT_SECRET" | "JWT_REFRESH_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/**
 * Which units this user may act on. Every user in Phase 1 is staff (members
 * carry no login), so this is always every active unit in the tenant — at
 * single-unit scale that's just the tenant's one CooperativeUnit.
 */
async function resolveUnitIds(tenantId: string): Promise<string[]> {
  const units = await db.cooperativeUnit.findMany({
    where: { tenantId, isActive: true },
    select: { id: true }
  });
  return units.map((u) => u.id);
}

function issue(claims: AuthClaims, firebaseAuthTime?: number): { accessToken: string; refreshToken: string } {
  return {
    accessToken: signAccessToken(claims, secret("JWT_SECRET"), process.env.JWT_EXPIRES_IN ?? "15m"),
    // The refresh token carries identity only. Units, role, and permissions are
    // re-derived on every refresh, so a permission change lands within one
    // access-token lifetime instead of persisting for the refresh token's
    // whole validity.
    refreshToken: jwt.sign(
      { userId: claims.userId, tenantId: claims.tenantId, typ: "refresh", ...(firebaseAuthTime ? { firebaseAuthTime } : {}) },
      secret("JWT_REFRESH_SECRET"),
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d" } as jwt.SignOptions
    )
  };
}

export async function sessionFor(user: UserWithRole, firebaseAuthTime?: number): Promise<Session> {
  const unitIds = await resolveUnitIds(user.tenantId);
  if (unitIds.length === 0) {
    // Deliberately not a silent empty-scope login: a user who can reach no unit
    // can do nothing, and an empty unitIds claim is rejected at verify time.
    throw unauthorized("Account is not assigned to any unit");
  }

  const claims: AuthClaims = {
    userId: user.id,
    tenantId: user.tenantId,
    role: deriveUserRole(user),
    unitIds,
    roleId: user.roleId,
    permissions: user.role.permissions as unknown as Permissions
  };

  return { ...issue(claims, firebaseAuthTime), user: toPublicUser(user) };
}

export async function registerTenant(input: RegisterTenantInput): Promise<Session> {
  const data = registerSchema.parse(input);
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  const admin = await db
    .$transaction(async (tx) => {
      // The >=1 unit + seed-role invariants: created inside the same
      // transaction as the tenant, so a failure here leaves no orphan tenant.
      const { tenant, roles } = await provisionTenantInTx(tx, {
        name: data.tenantName,
        slug: data.slug,
        registrationNo: data.registrationNo,
        address: data.address,
        type: data.type,
        firstUnit: data.firstUnit
      });

      const superAdminRole = roles.find((r) => r.name === "Super Admin");
      if (!superAdminRole) throw new Error("Super Admin role was not seeded");

      return tx.user.create({
        data: {
          tenantId: tenant.id,
          roleId: superAdminRole.id,
          email: data.adminEmail,
          name: data.adminName,
          passwordHash
        },
        include: { role: true }
      });
    })
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) {
        throw conflict("A cooperative with that slug, registration number, or admin email already exists");
      }
      throw err;
    });

  return sessionFor(admin);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Prisma.PrismaClientKnownRequestError).code === "P2002"
  );
}

export async function login(
  slug: string | null,
  email: string,
  password: string
): Promise<Session> {
  if (!slug) {
    throw validationError("Cooperative not identified — use your cooperative's subdomain");
  }

  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant || !tenant.isActive) throw unauthorized("Cooperative not found or inactive");

  // Scoped by tenantId, not email alone: email is unique only within a tenant.
  const user = await db.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    include: { role: true }
  });

  // Hash a throwaway when the user is absent so the response time does not
  // reveal whether the address exists.
  const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok || !user.isActive) throw unauthorized();

  const session = await sessionFor(user);
  await db.user.update({ where: { id: user.id, tenantId: user.tenantId }, data: { lastLoginAt: new Date() } });
  return session;
}

export async function refreshSession(token: string): Promise<RefreshedSession> {
  let payload: unknown;
  try {
    payload = jwt.verify(token, secret("JWT_REFRESH_SECRET"));
  } catch {
    throw unauthorized("Invalid or expired refresh token");
  }

  const parsed = z.object({ userId: z.string().min(1), tenantId: z.string().min(1), typ: z.literal("refresh"), firebaseAuthTime: z.number().optional() }).safeParse(payload);
  // An access token verified with the refresh secret would already have failed
  // above; the `typ` check also rejects any future token minted with it.
  if (!parsed.success) throw unauthorized("Invalid or expired refresh token");

  const user = await db.user.findUnique({
    where: { id: parsed.data.userId, tenantId: parsed.data.tenantId },
    include: { role: true }
  });
  if (!user || !user.isActive) throw unauthorized("Invalid or expired refresh token");

  const tenant = await db.tenant.findUnique({ where: { id: user.tenantId } });
  if (!tenant?.isActive) throw unauthorized("Invalid or expired refresh token");

  if (user.firebaseUid) await assertFirebaseSession(user.firebaseUid, parsed.data.firebaseAuthTime);
  const { accessToken, refreshToken } = await sessionFor(user, parsed.data.firebaseAuthTime);
  return { accessToken, refreshToken };
}

export async function getMe(userId: string, tenantId: string): Promise<User | null> {
  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    include: { role: true }
  });
  return user ? toPublicUser(user) : null;
}

/** Self-service profile edit — name/email only; role/isActive are admin-only (see modules/users). */
export async function updateProfile(
  userId: string,
  tenantId: string,
  data: { name: string; email: string }
): Promise<User> {
  const user = await db.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw unauthorized();

  if (user.firebaseUid && data.email !== user.email) throw validationError("Email masuk dikelola melalui Firebase.");
  if (data.email !== user.email) {
    const duplicate = await db.user.findUnique({ where: { tenantId_email: { tenantId, email: data.email } } });
    if (duplicate) throw conflict(`Email ${data.email} sudah digunakan`);
  }

  const updated = await db.user.update({
    where: { id: userId, tenantId },
    data: { name: data.name, email: data.email },
    include: { role: true }
  });
  return toPublicUser(updated);
}

export async function changePassword(
  userId: string,
  tenantId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await db.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) throw unauthorized();

  if (user.firebaseUid || !user.passwordHash) throw validationError("Gunakan Lupa kata sandi pada halaman masuk untuk akun Firebase.");
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw unauthorized("Password saat ini salah");

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.user.update({ where: { id: userId, tenantId }, data: { passwordHash } });
}
