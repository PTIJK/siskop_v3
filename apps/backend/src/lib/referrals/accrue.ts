import { Prisma, type Invoice, type Payment, type ReferralCommission } from "@prisma/client";
import type { TxClient } from "../db.js";
import { writePricingAudit } from "../pricing/audit.js";
import { addMonths } from "../pricing/billing-dates.js";

/** base × rate, rounded half up to whole sen. */
export function commissionAmount(base: Prisma.Decimal, rate: Prisma.Decimal): Prisma.Decimal {
  return base.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Exclusive end of the commission window: invoices paid before it earn commission. */
export function referralWindowEnd(attributedAt: Date, months: number): Date {
  return addMonths(attributedAt, months);
}

/**
 * Runs inside confirmPayment's transaction so a payment and its commission
 * commit together. Earns `subtotal × rate` (VAT is not the partner's) when the
 * tenant has a referral and the payment falls in [attributedAt, windowEndsAt).
 * The unique invoiceId keeps it to one commission per invoice.
 */
export async function accrueCommission(
  tx: TxClient,
  { invoice, payment, actorId }: { invoice: Invoice; payment: Payment; actorId?: string | null }
): Promise<ReferralCommission | null> {
  const referral = await tx.tenantReferral.findUnique({ where: { tenantId: invoice.tenantId } });
  if (!referral) return null;
  if (payment.paidAt < referral.attributedAt || payment.paidAt >= referral.windowEndsAt) return null;

  const amount = commissionAmount(invoice.subtotal, referral.rate);
  if (amount.lte(0)) return null;

  const commission = await tx.referralCommission.create({
    data: {
      partnerId: referral.partnerId,
      tenantId: invoice.tenantId,
      referralId: referral.id,
      invoiceId: invoice.id,
      paymentId: payment.id,
      baseAmount: invoice.subtotal,
      rate: referral.rate,
      amount,
      accruedAt: payment.paidAt
    }
  });
  await writePricingAudit(tx, {
    actorId: actorId ?? null,
    entity: "referral_commission",
    entityId: commission.id,
    action: "ACCRUED",
    after: {
      partnerId: referral.partnerId,
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
      baseAmount: invoice.subtotal.toFixed(2),
      rate: referral.rate.toFixed(4),
      amount: amount.toFixed(2)
    }
  });
  return commission;
}
