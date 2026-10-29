import type { BillingCycle } from "@siskop/types";

/**
 * Adds one billing cycle (UTC). A month that is too short clamps to its last
 * day (Jan 31 + 1 month = Feb 28). `anchorDay` is the day of month the schedule
 * started on: with it, Feb 28 + 1 month gives Mar 31 again instead of drifting
 * to Mar 28 for good.
 */
export function addCycle(from: Date, cycle: BillingCycle, anchorDay: number = from.getUTCDate()): Date {
  const months = cycle === "YEARLY" ? 12 : 1;
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, lastDay));
  target.setUTCHours(from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds());
  return target;
}

/**
 * How often a subscription is invoiced. A package with a price follows its
 * billing cycle. A free package with a paid support plan is invoiced once a
 * year for the support fee. A free package alone is never invoiced (null).
 */
export function billingPeriod(sub: { amountPerCycle: { isZero(): boolean }; billingCycle: BillingCycle; supportPlanId: string | null }): BillingCycle | null {
  if (!sub.amountPerCycle.isZero()) return sub.billingCycle;
  return sub.supportPlanId ? "YEARLY" : null;
}
