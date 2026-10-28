import type { NextFunction, Request, Response } from "express";
import { featureNotEntitled } from "../lib/errors.js";
import { getTenantEntitlements } from "../lib/pricing/entitlements.js";
import { enforcementMode } from "../lib/pricing/flags.js";
import { authClaims } from "./auth.js";

/**
 * Pricing V2 gate: the tenant's subscription must include `key`. Mount after
 * requireAuth. Behaviour follows PRICING_V2_ENFORCEMENT (off / shadow / on).
 * This replaces the single `accounting` package flag in middleware/entitlement.ts.
 */
export function requireFeature(key: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const mode = enforcementMode();
      if (mode === "off") return next();

      const { tenantId } = authClaims(req);
      const ent = await getTenantEntitlements(tenantId);
      if (ent?.hasFeature(key)) return next();

      if (mode === "shadow") {
        console.warn(`PRICING_SHADOW FEATURE_NOT_ENTITLED tenant=${tenantId} feature=${key}`);
        return next();
      }
      throw featureNotEntitled("Paket langganan Anda tidak mencakup fitur ini", { feature: key });
    } catch (err) {
      next(err);
    }
  };
}
