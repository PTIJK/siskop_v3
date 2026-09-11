import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { ErrorCode, type AuthClaims } from "@siskop/types";
import { unauthorized as unauthorizedError } from "../lib/errors.js";

// Every action is optional: a role's permissions blob only sets the actions it
// actually grants (see the SEED_ROLES default permission sets in
// tenants/provision.ts), so an absent key must read as "not granted", not fail
// validation.
const permissionActions = z.object({
  create: z.boolean().optional(),
  read: z.boolean().optional(),
  update: z.boolean().optional(),
  delete: z.boolean().optional(),
  export: z.boolean().optional()
});

const permissionsSchema = z.object({
  dashboard: permissionActions,
  members: permissionActions,
  savings: permissionActions,
  loans: permissionActions,
  reports: permissionActions,
  config: permissionActions,
  users: permissionActions,
  roles: permissionActions,
  accounting: permissionActions.optional(),
  // Phase 2 (KSU Konsumen/Toko) — optional like `accounting`: a token signed
  // before this module existed still parses, `permissions.konsumen` just
  // comes back undefined (requirePermission("konsumen", ...) then denies).
  konsumen: permissionActions.optional()
});

const claimsSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  role: z.enum(["super_admin", "tenant_admin", "accountant", "member"]),
  unitIds: z.array(z.string().min(1)).min(1, "unitIds must not be empty"),
  roleId: z.string().min(1),
  permissions: permissionsSchema
});

// Carrying unitIds in the token trades staleness for a saved permission lookup
// on every request: a unit-access change takes up to JWT_EXPIRES_IN (15m) to
// take effect. `permissions` (see requirePermission in middleware/rbac.ts)
// accepts that tradeoff. Real unit-access enforcement does not: it needs a
// brand-new CooperativeUnit to be usable by its creator immediately, not
// after JWT_EXPIRES_IN — see lib/unit-access.ts#assertUnitAccess, which
// re-derives the caller's unit scope from the DB on every request instead of
// trusting this claim. `unitIds` here is kept for the token's shape/audit
// value only; nothing reads it for enforcement.

export function signAccessToken(claims: AuthClaims, secret: string, expiresIn: string): string {
  return jwt.sign(claims, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyAccessToken(token: string, secret: string): AuthClaims {
  const decoded = jwt.verify(token, secret);
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Prefix with the field path: a *missing* claim yields zod's generic
    // "Required", which would not tell you which claim was absent.
    const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown";
    throw new Error(`Invalid token claims: ${detail}`);
  }
  return parsed.data;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthClaims;
  }
}

/**
 * Reads `req.auth`, populated by `requireAuth`. Every route using this must be
 * mounted behind that middleware — throws (rather than returning undefined)
 * so call sites get a non-nullable `AuthClaims` without repeating the guard.
 */
export function authClaims(req: Request): AuthClaims {
  if (!req.auth) throw unauthorizedError();
  return req.auth;
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({
    success: false,
    error: { code: ErrorCode.UNAUTHORIZED, message },
    meta: { timestamp: new Date().toISOString(), requestId: randomUUID() }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    unauthorized(res, "Missing bearer token");
    return;
  }

  try {
    req.auth = verifyAccessToken(token, process.env.JWT_SECRET ?? "");
    next();
  } catch {
    unauthorized(res, "Invalid or expired token");
  }
}
