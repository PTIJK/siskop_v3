import type { Request, Response, NextFunction } from "express";
import { db } from "../lib/db.js";
import { featureNotEntitled } from "../lib/errors.js";
import { authClaims } from "./auth.js";

/**
 * A tenant with no `packageId` (self-service registrations, or tenants seeded
 * before packages existed — see prisma/seed.ts's Barokah tenant) is treated as
 * having no add-on modules: `package` is null, so `?.modules?.includes(...)`
 * and `?.whitelabelEnabled` both fall through to "not entitled". Base
 * modules (Members/Savings/Loans/Dashboard/plain Reports) are never gated —
 * only the accounting/whitelabel add-ons below are.
 */
async function tenantPackage(tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, include: { package: true } });
  return tenant?.package ?? null;
}

/** Gates Konfigurasi Akun (COA), Account Mappings, SHU config, and Laporan Regulasi on the "accounting" package module. */
export async function requireAccountingEntitlement(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const pkg = await tenantPackage(authClaims(req).tenantId);
    if (!pkg?.modules?.includes("accounting")) {
      throw featureNotEntitled("Paket langganan Anda tidak mengaktifkan modul akuntansi");
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Gates writes to WhitelabelConfig on the package's whitelabelEnabled flag. */
export async function requireWhitelabelEntitlement(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const pkg = await tenantPackage(authClaims(req).tenantId);
    if (!pkg?.whitelabelEnabled) {
      throw featureNotEntitled("Paket langganan Anda tidak mengaktifkan fitur whitelabel");
    }
    next();
  } catch (err) {
    next(err);
  }
}
