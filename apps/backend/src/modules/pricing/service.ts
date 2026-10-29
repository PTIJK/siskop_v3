import type { TenantSubscriptionInfo } from "@siskop/types";
import { db } from "../../lib/db.js";
import { getPublishedCatalog } from "../../lib/pricing/catalog.js";
import { getTenantEntitlements, getUsage } from "../../lib/pricing/entitlements.js";
import { enforcementMode } from "../../lib/pricing/flags.js";

/** What the tenant app loads at login. Null until the tenant has a subscription. */
export async function getSubscriptionInfo(tenantId: string): Promise<TenantSubscriptionInfo | null> {
  const ent = await getTenantEntitlements(tenantId);
  if (!ent) return null;

  // Filtered by the caller's own tenantId, never by anything from the request.
  const open = await db.invoice.findFirst({
    where: { tenantId, status: "OPEN" },
    orderBy: { dueDate: "asc" },
    select: { number: true, type: true, total: true, dueDate: true }
  });
  const instructions = open ? await paymentInstructions() : null;

  return {
    packageCode: ent.packageCode,
    packageName: ent.packageName,
    status: ent.status,
    billingCycle: ent.billingCycle,
    nextBillingDate: ent.nextBillingDate,
    features: ent.features,
    limits: ent.limits,
    usage: await getUsage(tenantId),
    enforcement: enforcementMode(),
    openInvoice: open ? { number: open.number, type: open.type, total: open.total.toFixed(2), dueDate: open.dueDate.toISOString() } : null,
    paymentInstructions: instructions
  };
}

async function paymentInstructions(): Promise<string | null> {
  try {
    return (await getPublishedCatalog()).snapshot.settings.paymentInstructions;
  } catch {
    return null;
  }
}
