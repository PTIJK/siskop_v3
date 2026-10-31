import { Prisma } from "@prisma/client";
import type { RevenueSummary } from "@siskop/types";
import { db } from "../../lib/db.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { monthBuckets } from "./buckets.js";
import { jakartaColumn, utcParam } from "./counts.js";

const ZERO = new Prisma.Decimal(0);
const money = (d: Prisma.Decimal) => d.toFixed(2);

/** Percent change to one decimal; null when there is nothing to compare against. */
export function deltaPct(current: Prisma.Decimal, previous: Prisma.Decimal): number | null {
  if (previous.isZero()) return null;
  return Math.round(current.minus(previous).div(previous).times(1000).toNumber()) / 10;
}

/** Monthly recurring revenue: MONTHLY as-is, YEARLY divided by 12. */
export function mrrOf(subs: { billingCycle: "MONTHLY" | "YEARLY"; amountPerCycle: Prisma.Decimal }[]): Prisma.Decimal {
  return subs.reduce((sum, s) => sum.plus(s.billingCycle === "YEARLY" ? s.amountPerCycle.div(12) : s.amountPerCycle), ZERO);
}

/** Cash-basis revenue: payments recorded against PAID subscription invoices, per Asia/Jakarta month, last 12 months. */
export async function getRevenue(now: Date): Promise<RevenueSummary> {
  const months = monthBuckets(now, 12);
  const since = months[0]!.start;

  const [rows, subs] = await Promise.all([
    db.$queryRaw<{ bucket: string; total: string }[]>(Prisma.sql`
      SELECT to_char(date_trunc('month', ${jakartaColumn(Prisma.sql`p."paidAt"`)}), 'YYYY-MM') AS bucket, SUM(p.amount)::text AS total
      FROM "Payment" p
      JOIN "Invoice" i ON i.id = p."invoiceId"
      WHERE i.status = 'PAID' AND p."paidAt" >= ${utcParam(since)}
      GROUP BY 1
    `),
    withoutTenantScope(async () =>
      db.tenantSubscription.findMany({ where: { status: "ACTIVE" }, select: { billingCycle: true, amountPerCycle: true } })
    )
  ]);

  const byMonth = new Map(rows.map((r) => [r.bucket, new Prisma.Decimal(r.total)]));
  const series = months.map((m) => ({ month: m.key, amount: money(byMonth.get(m.key) ?? ZERO) }));
  const thisMonth = byMonth.get(months.at(-1)!.key) ?? ZERO;
  const previousMonth = byMonth.get(months.at(-2)!.key) ?? ZERO;

  return {
    series,
    thisMonth: money(thisMonth),
    previousMonth: money(previousMonth),
    deltaPct: deltaPct(thisMonth, previousMonth),
    mrr: money(mrrOf(subs))
  };
}
