import { db, type TxClient } from "./db.js";
import { notFound } from "./errors.js";

/**
 * The tenant's sole CooperativeUnit, for services that need a `unitId` but
 * have no unit-picker UI (Phase 1 — see merge plan "unit scoping"). Every
 * financial row (Saving/Loan) resolves its unit through this, never from
 * client input, so multi-unit support can be added later without touching
 * any route contract.
 */
export async function getDefaultUnitId(tenantId: string): Promise<string> {
  const unit = await db.cooperativeUnit.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: "asc" }
  });
  if (!unit) throw new Error(`Tenant ${tenantId} has no active unit`);
  return unit.id;
}

/**
 * Day 2 (KSU multi-unit spike): resolves the `unitId` a financial row should
 * be stamped with, allowing a caller to explicitly target one of the
 * tenant's units instead of always taking the default. When `unitId` is
 * omitted this is byte-for-byte the `getDefaultUnitId` path every existing
 * caller already relies on. When a `unitId` is supplied, it MUST be an
 * active `CooperativeUnit` owned by `tenantId` — never trusted at face
 * value, since `unitId` may ultimately come from client input and a client
 * must not be able to link a row to another tenant's unit (CLAUDE.md rule 1).
 */
export async function resolveUnitId(tenantId: string, unitId?: string): Promise<string> {
  if (!unitId) return getDefaultUnitId(tenantId);

  const unit = await db.cooperativeUnit.findFirst({ where: { id: unitId, tenantId, isActive: true } });
  if (!unit) throw notFound("Unit tidak ditemukan");
  return unit.id;
}

/**
 * The tenant's first active unit of `type`, creating one named `defaultName`
 * if none exists yet — for a resource (koperasi pasar's Market, F3) whose
 * unit is never client-chosen, only ever "the tenant's JASA unit", same as a
 * KSU's units already aren't auto-created by any UI (CooperativeUnit.type is
 * a free-form string, not this function's business to validate beyond `type`).
 */
export async function ensureUnitOfType(tx: TxClient, tenantId: string, type: string, defaultName: string): Promise<string> {
  const existing = await tx.cooperativeUnit.findFirst({
    where: { tenantId, type, isActive: true },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing.id;

  const created = await tx.cooperativeUnit.create({ data: { tenantId, type, name: defaultName, isActive: true } });
  return created.id;
}
