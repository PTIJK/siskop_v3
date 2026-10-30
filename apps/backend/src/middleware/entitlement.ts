import type { Request, Response, NextFunction } from "express";
import type { SubscriptionPackage } from "@prisma/client";
import { db } from "../lib/db.js";
import { featureNotEntitled } from "../lib/errors.js";
import { getTenantEntitlements } from "../lib/pricing/entitlements.js";
import { enforcementMode } from "../lib/pricing/flags.js";
import { authClaims } from "./auth.js";
import { featuresForRequest } from "./enforcement.js";

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

/**
 * Legacy flags only exist on packages made by the old platform form. A Pricing
 * V2 catalog package (one with a `code`) never carries them, yet the
 * subscription dialog and registration point Tenant.packageId at one, so for
 * that tenant the subscription is the only record: it must grant every
 * feature the central enforcement map lists for this route.
 */
async function legacyEntitled(req: Request, flag: (pkg: SubscriptionPackage) => boolean): Promise<boolean> {
  const { tenantId } = authClaims(req);
  const pkg = await tenantPackage(tenantId);
  if (!pkg) return false;
  if (pkg.code === null) return flag(pkg);
  const ent = await getTenantEntitlements(tenantId);
  if (!ent) return false;
  const path = `${req.baseUrl}${req.path}`.replace(/^\/api(?=\/|$)/, "");
  return featuresForRequest(req.method, path).every((key) => ent.hasFeature(key));
}

/** Gates Konfigurasi Akun (COA), Account Mappings, SHU config, and Laporan Regulasi on the "accounting" package module. */
export async function requireAccountingEntitlement(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    // With Pricing V2 on, the central gate (middleware/enforcement.ts) decides from the subscription.
    if (enforcementMode() === "on") return next();
    if (!(await legacyEntitled(req, (pkg) => pkg.modules.includes("accounting")))) {
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
    // With Pricing V2 on, the central gate (middleware/enforcement.ts) decides from the subscription.
    if (enforcementMode() === "on") return next();
    if (!(await legacyEntitled(req, (pkg) => pkg.whitelabelEnabled))) {
      throw featureNotEntitled("Paket langganan Anda tidak mengaktifkan fitur whitelabel");
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Gates the koperasi pasar add-on (Market/Stall and Kolektor & setoran —
 * F3/F4-F7 of the koperasi pasar plan) on the package's "pasar" module.
 * Decision D6: F0-F2 (loan installment schedule) stay in the base package
 * since they fix the core loan module (correct KOL for monthly loans too),
 * but the pasar-specific modules are a paid add-on like "accounting".
 */
export async function requirePasarEntitlement(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    // With Pricing V2 on, the central gate (middleware/enforcement.ts) decides from the subscription.
    if (enforcementMode() === "on") return next();
    if (!(await legacyEntitled(req, (pkg) => pkg.modules.includes("pasar")))) {
      throw featureNotEntitled("Paket langganan Anda tidak mengaktifkan modul pasar");
    }
    next();
  } catch (err) {
    next(err);
  }
}
