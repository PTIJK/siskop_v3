import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Prisma, User as DbUser } from "@prisma/client";
import {
  CooperativeType,
  type AuthClaims,
  type LoginResponse,
  type RefreshResponse,
  type User,
  type UserRole
} from "@siskop/types";
import { db } from "../../lib/db.js";
import { slugSchema } from "../tenants/provision.js";
import { signAccessToken } from "../../middleware/auth.js";
import { unauthorized, conflict, validationError } from "../../lib/errors.js";

const BCRYPT_ROUNDS = 10;

const registerSchema = z.object({
  tenantName: z.string().min(1),
  slug: slugSchema,
  cooperativeId: z.string().min(1),
  address: z.string().min(1),
  // Globally unique, unlike adminEmail which is unique only within the tenant.
  tenantEmail: z.string().email().optional(),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPhone: z.string().min(1),
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

function toPublicUser(user: DbUser): User {
  // Built field-by-field rather than by deleting passwordHash, so a column
  // added to the model later cannot leak by default.
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    phone: user.phone,
    name: user.name,
    role: user.role as UserRole,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

/**
 * Which units this user may act on. Members are scoped to the units they have
 * actually joined; staff roles see every active unit in their tenant.
 */
async function resolveUnitIds(user: DbUser): Promise<string[]> {
  if (user.role === "member") {
    const memberships = await db.unitMembership.findMany({
      where: { member: { userId: user.id } },
      select: { unitId: true }
    });
    return memberships.map((m) => m.unitId);
  }

  const units = await db.cooperativeUnit.findMany({
    where: { tenantId: user.tenantId, isActive: true },
    select: { id: true }
  });
  return units.map((u) => u.id);
}

function issue(claims: AuthClaims): { accessToken: string; refreshToken: string } {
  return {
    accessToken: signAccessToken(claims, secret("JWT_SECRET"), process.env.JWT_EXPIRES_IN ?? "15m"),
    // The refresh token carries identity only. Units and role are re-derived on
    // every refresh, so a permission change lands within one access-token
    // lifetime instead of persisting for the refresh token's whole validity.
    refreshToken: jwt.sign(
      { userId: claims.userId, tenantId: claims.tenantId, typ: "refresh" },
      secret("JWT_REFRESH_SECRET"),
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d" } as jwt.SignOptions
    )
  };
}

async function sessionFor(user: DbUser): Promise<LoginResponse> {
  const unitIds = await resolveUnitIds(user);
  if (unitIds.length === 0) {
    // Deliberately not a silent empty-scope login: a user who can reach no unit
    // can do nothing, and an empty unitIds claim is rejected at verify time.
    throw unauthorized("Account is not assigned to any unit");
  }

  const claims: AuthClaims = {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role as UserRole,
    unitIds
  };

  return { ...issue(claims), user: toPublicUser(user) };
}

export async function registerTenant(input: RegisterTenantInput): Promise<LoginResponse> {
  const data = registerSchema.parse(input);
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  const admin = await db
    .$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.tenantName,
          slug: data.slug,
          cooperativeId: data.cooperativeId,
          email: data.tenantEmail ?? data.adminEmail,
          phone: data.adminPhone,
          address: data.address
        }
      });

      // The >=1 unit invariant: created inside the same transaction as the
      // tenant, so a failure here leaves no unitless tenant behind.
      await tx.cooperativeUnit.create({
        data: { tenantId: tenant.id, type: data.firstUnit.type, name: data.firstUnit.name }
      });

      return tx.user.create({
        data: {
          tenantId: tenant.id,
          email: data.adminEmail,
          phone: data.adminPhone,
          name: data.adminName,
          passwordHash,
          role: "tenant_admin"
        }
      });
    })
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) {
        throw conflict("A cooperative with that slug, code, or email already exists");
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
): Promise<LoginResponse> {
  if (!slug) {
    throw validationError("Cooperative not identified — use your cooperative's subdomain");
  }

  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant || !tenant.isActive) throw unauthorized("Cooperative not found or inactive");

  // Scoped by tenantId, not email alone: email is unique only within a tenant.
  const user = await db.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } }
  });

  // Hash a throwaway when the user is absent so the response time does not
  // reveal whether the address exists.
  const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok || !user.isActive) throw unauthorized();

  const session = await sessionFor(user);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return session;
}

export async function refreshSession(token: string): Promise<RefreshResponse> {
  let payload: unknown;
  try {
    payload = jwt.verify(token, secret("JWT_REFRESH_SECRET"));
  } catch {
    throw unauthorized("Invalid or expired refresh token");
  }

  const parsed = z.object({ userId: z.string().min(1), typ: z.literal("refresh") }).safeParse(payload);
  // An access token verified with the refresh secret would already have failed
  // above; the `typ` check also rejects any future token minted with it.
  if (!parsed.success) throw unauthorized("Invalid or expired refresh token");

  const user = await db.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user || !user.isActive) throw unauthorized("Invalid or expired refresh token");

  const tenant = await db.tenant.findUnique({ where: { id: user.tenantId } });
  if (!tenant?.isActive) throw unauthorized("Invalid or expired refresh token");

  const { accessToken, refreshToken } = await sessionFor(user);
  return { accessToken, refreshToken };
}
