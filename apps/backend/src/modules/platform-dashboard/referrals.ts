import { Prisma } from "@prisma/client";
import type { ReferralSummary } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { monthBuckets } from "./buckets.js";

const money = (d: Prisma.Decimal | null | undefined) => (d ?? new Prisma.Decimal(0)).toFixed(2);
const live = { status: { not: "VOID" as const } };

/**
 * Referral program totals for the platform dashboard. Revenue is the commissionable base (invoice
 * subtotal before VAT) of commissions that were not voided, so it matches the partner pages.
 * "This month" follows the Asia/Jakarta calendar, like the rest of the dashboard.
 */
export async function getReferralSummary(now: Date): Promise<ReferralSummary> {
  const monthStart = monthBuckets(now, 1)[0]!.start;
  return withoutTenantScope(async () => {
    const [activePartners, pendingApplications, referredTenants, total, month, outstanding] = await Promise.all([
      db.referralPartner.count({ where: { status: "ACTIVE" } }),
      db.referralPartner.count({ where: { status: "PENDING" } }),
      db.tenantReferral.count(),
      db.referralCommission.aggregate({ where: live, _sum: { baseAmount: true } }),
      db.referralCommission.aggregate({ where: { ...live, accruedAt: { gte: monthStart } }, _sum: { baseAmount: true, amount: true } }),
      db.referralCommission.aggregate({ where: { status: "ACCRUED" }, _sum: { amount: true } })
    ]);
    return {
      activePartners,
      pendingApplications,
      referredTenants,
      referredRevenueThisMonth: money(month._sum.baseAmount),
      referredRevenueTotal: money(total._sum.baseAmount),
      commissionThisMonth: money(month._sum.amount),
      commissionOutstanding: money(outstanding._sum.amount)
    };
  });
}
