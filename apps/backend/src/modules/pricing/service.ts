import type { TenantSubscriptionInfo } from "@siskop/types";
import { getTenantEntitlements, getUsage } from "../../lib/pricing/entitlements.js";

/** What the tenant app loads at login. Null until the tenant has a subscription. */
export async function getSubscriptionInfo(tenantId: string): Promise<TenantSubscriptionInfo | null> {
  const ent = await getTenantEntitlements(tenantId);
  if (!ent) return null;
  return {
    packageCode: ent.packageCode,
    packageName: ent.packageName,
    status: ent.status,
    billingCycle: ent.billingCycle,
    nextBillingDate: ent.nextBillingDate,
    features: ent.features,
    limits: ent.limits,
    usage: await getUsage(tenantId)
  };
}
