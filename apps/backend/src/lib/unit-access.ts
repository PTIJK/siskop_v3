import { db } from "./db.js";
import { forbidden } from "./errors.js";

/**
 * A user's real-time unit scope: explicit `UserUnit` rows if any exist, else
 * every active unit in their tenant. The fallback preserves the pre-unit-
 * scoping behavior (every user could act on every unit) for anyone nobody
 * has explicitly assigned yet — platform admins, users inserted directly
 * against the DB, and every user that existed before this table did. Only a
 * user with at least one explicit `UserUnit` row (created via
 * `POST /users`'s required `unitIds`) is actually restricted.
 *
 * Always resolved fresh from the DB, never cached in the JWT: unlike
 * `permissions`, a brand-new `CooperativeUnit` must be usable by its creator
 * immediately, not after `JWT_EXPIRES_IN` — see `AuthClaims.unitIds`'s doc
 * comment in middleware/auth.ts for the tradeoff this sidesteps.
 */
export async function getEffectiveUnitIds(userId: string, tenantId: string): Promise<string[]> {
  const assigned = await db.userUnit.findMany({ where: { userId }, select: { unitId: true } });
  if (assigned.length > 0) return assigned.map((a) => a.unitId);

  const units = await db.cooperativeUnit.findMany({ where: { tenantId, isActive: true }, select: { id: true } });
  return units.map((u) => u.id);
}

/**
 * Call this only after the unit's tenant ownership has already been
 * confirmed (e.g. via lib/units.ts#resolveUnitId, which 404s a cross-tenant
 * or nonexistent unit first) — this only distinguishes "your tenant's unit
 * you aren't scoped to" (403) from "not your tenant's unit" (404 upstream),
 * not the reverse.
 */
export async function assertUnitAccess(userId: string, tenantId: string, unitId: string): Promise<void> {
  const unitIds = await getEffectiveUnitIds(userId, tenantId);
  if (!unitIds.includes(unitId)) {
    throw forbidden(`No access to unit ${unitId}`);
  }
}
