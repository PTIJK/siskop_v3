import type { Request, Response, NextFunction } from "express";
import type { PermissionAction, PermissionModule } from "@siskop/types";
import { unauthorized, forbidden } from "../lib/errors.js";

/**
 * Fine-grained RBAC on top of `requireAuth`: `req.auth.permissions` travels in
 * the JWT (see middleware/auth.ts), so this is a pure claim check, no DB round
 * trip. Ported from the pre-rescaffold system's `rbac.middleware.ts` — module
 * names and actions match `Permissions` in packages/types/src/role.ts exactly,
 * so seeded role permission blobs (tenants/provision.ts) work unmodified.
 */
export function requirePermission(module: PermissionModule, action: PermissionAction) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) throw unauthorized();

    const modulePerms = auth.permissions[module] as Record<string, boolean> | undefined;
    if (!modulePerms?.[action]) {
      throw forbidden(`Missing ${module}.${action} permission`);
    }

    next();
  };
}

/**
 * Gates cross-tenant platform routes (modules/platform) on the coarse
 * `AuthClaims.role` claim, not the fine-grained `Permissions` blob —
 * `requirePermission` checks permissions scoped to the caller's own tenant,
 * which is the wrong axis for an operation that reads/writes *other* tenants.
 */
export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) throw unauthorized();
  if (auth.role !== "super_admin") throw forbidden("Platform admin access required");
  next();
}
