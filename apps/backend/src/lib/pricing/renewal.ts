import { Prisma } from "@prisma/client";
import type { BillingCycle, PricingQuote } from "@siskop/types";
import { billingPeriod } from "./billing-dates.js";

type Amounts = Pick<PricingQuote, "subtotal" | "taxRate" | "taxAmount" | "total">;

const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Whole months from `from` to `to`, by calendar month (UTC), ignoring the day. */
function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

export interface RenewalSource {
  amountPerCycle: Prisma.Decimal;
  billingCycle: BillingCycle;
  supportPlanId: string | null;
  startsAt: Date;
}

/**
 * What the next invoice for a running subscription costs. The package price is
 * the one frozen on the subscription (a later catalog edit never reprices it);
 * the support fee is the yearly figure from the catalog version it subscribed
 * under. VAT is the rate the owner has published now, so changing it applies
 * from the next invoice. Support is charged once a year: on every yearly
 * invoice, and on a monthly one only in the anniversary month.
 */
export function renewalAmounts(
  sub: RenewalSource,
  dueDate: Date,
  supportYearlyCost: string | null,
  taxRate: string | null
): Amounts {
  const period = billingPeriod(sub);
  const supportDue = sub.supportPlanId !== null && (period === "YEARLY" || monthsBetween(sub.startsAt, dueDate) % 12 === 0);
  const support = supportDue ? new Prisma.Decimal(supportYearlyCost ?? 0) : new Prisma.Decimal(0);
  const subtotal = round2(sub.amountPerCycle.plus(support));
  const tax = taxRate === null ? new Prisma.Decimal(0) : round2(subtotal.times(new Prisma.Decimal(taxRate)));
  return { subtotal: subtotal.toFixed(2), taxRate, taxAmount: tax.toFixed(2), total: subtotal.plus(tax).toFixed(2) };
}
