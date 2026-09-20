import { db } from "./db.js";
import { forbidden, notFound } from "./errors.js";

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

// ── Read access (reports, history) ───────────────────────────────────────────
// getEffectiveUnitIds/assertUnitAccess answer "may I ACT on this unit" and so
// only ever cover active units for an unscoped user. Reading a unit's history
// is a different question: a closed (inactive) unit's sales and ledger are
// still real, and a report that silently drops them would stop agreeing with
// the consolidated ledger. These helpers therefore include inactive units.

/**
 * Units the caller may read reports/history for: their explicit `UserUnit`
 * assignment if they have one (it may include a since-closed unit), else every
 * unit of their tenant, closed ones included.
 */
export async function getReadableUnitIds(userId: string, tenantId: string): Promise<string[]> {
  const assigned = await db.userUnit.findMany({ where: { userId }, select: { unitId: true } });
  if (assigned.length > 0) return assigned.map((a) => a.unitId);

  const units = await db.cooperativeUnit.findMany({ where: { tenantId }, select: { id: true } });
  return units.map((u) => u.id);
}

/**
 * Like resolveUnitId + assertUnitAccess for reading: 404 for a unit that isn't
 * this tenant's (never confirming another tenant's unit exists), 403 for one
 * that is but the caller isn't assigned to, and — unlike resolveUnitId — no
 * objection to an inactive unit.
 */
export async function resolveReadableUnitId(tenantId: string, userId: string, unitId: string): Promise<string> {
  const unit = await db.cooperativeUnit.findFirst({ where: { id: unitId, tenantId }, select: { id: true } });
  if (!unit) throw notFound("Unit tidak ditemukan");

  const readable = await getReadableUnitIds(userId, tenantId);
  if (!readable.includes(unit.id)) throw forbidden(`No access to unit ${unit.id}`);
  return unit.id;
}

/** The full unit rows behind getReadableUnitIds, oldest first — what the UI offers as "my units". */
export async function listReadableUnits(tenantId: string, userId: string) {
  const ids = await getReadableUnitIds(userId, tenantId);
  return db.cooperativeUnit.findMany({ where: { tenantId, id: { in: ids } }, orderBy: { createdAt: "asc" } });
}
