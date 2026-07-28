import { db } from "./db.js";

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
