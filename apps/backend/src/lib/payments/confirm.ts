import { Prisma, type Invoice, type Payment } from "@prisma/client";
import { conflict, notFound } from "../errors.js";
import { db } from "../db.js";
import { writePricingAudit } from "../pricing/audit.js";
import { addCycle, billingPeriod } from "../pricing/billing-dates.js";
import { clearEntitlementCache } from "../pricing/entitlements.js";
import { withoutTenantScope } from "../tenant-scope.js";
import { findBillingContact, sendReceiptEmail } from "./emails.js";

export interface ConfirmPaymentOptions {
  /** How it was paid, e.g. BANK_TRANSFER. Stored on the Payment. */
  method?: string;
  /** The bank or gateway reference. */
  gatewayTxnId?: string | null;
  /** Platform admin who confirmed it; null for a gateway. */
  confirmedBy?: string | null;
  now?: Date;
}

export interface ConfirmPaymentResult {
  invoice: Invoice;
  payment: Payment;
  /** True when the invoice was already paid: nothing was changed. */
  alreadyPaid: boolean;
}

/**
 * Settles an invoice. Safe to call any number of times, from the owner's
 * mark-paid button or a gateway webhook alike: the invoice row is locked, so
 * simultaneous calls take turns and only the first records a payment.
 *
 * Registration invoice: the subscription starts now and the tenant becomes
 * active. Renewal invoice: the billing date moves one period on from the old
 * date (paying early costs nothing) and a past-due subscription is lifted.
 */
export async function confirmPayment(invoiceId: string, options: ConfirmPaymentOptions = {}): Promise<ConfirmPaymentResult> {
  const now = options.now ?? new Date();

  const outcome = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
      if (locked.length === 0) throw notFound("Invoice not found");
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { subscription: true } });

      if (invoice.status === "PAID") {
        const payment = await tx.payment.findFirstOrThrow({ where: { invoiceId, tenantId: invoice.tenantId }, orderBy: { paidAt: "asc" } });
        return { invoice, payment, alreadyPaid: true, nextBillingDate: invoice.subscription.nextBillingDate, registration: false, tenantName: "" };
      }
      if (invoice.status !== "OPEN") throw conflict(`Invoice ${invoice.number} is ${invoice.status.toLowerCase()} and cannot be paid`);

      const sub = invoice.subscription;
      const period = billingPeriod(sub);
      const revive = sub.status !== "CANCELLED";

      const payment = await tx.payment.create({
        data: {
          tenantId: invoice.tenantId,
          invoiceId,
          gatewayTxnId: options.gatewayTxnId ?? null,
          method: options.method ?? "MANUAL",
          amount: invoice.total,
          paidAt: now
        }
      });
      const paid = await tx.invoice.update({ where: { id: invoiceId }, data: { status: "PAID" } });

      let startsAt = sub.startsAt;
      let nextBillingDate = sub.nextBillingDate;
      if (invoice.type === "REGISTRATION") {
        startsAt = now;
        nextBillingDate = period ? addCycle(now, period) : null;
      } else if (invoice.type === "RENEWAL") {
        nextBillingDate = period ? addCycle(sub.nextBillingDate ?? now, period, sub.startsAt.getUTCDate()) : null;
      }
      await tx.tenantSubscription.update({
        where: { id: sub.id },
        data: { startsAt, nextBillingDate, ...(revive ? { status: "ACTIVE" as const } : {}) }
      });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId } });
      if (revive && !tenant.isActive) await tx.tenant.update({ where: { id: tenant.id }, data: { isActive: true } });

      if (invoice.type === "REGISTRATION") {
        await tx.notification.create({
          data: {
            type: "TENANT_REGISTERED",
            title: "Koperasi baru terdaftar",
            message: `${tenant.name} membayar faktur ${invoice.number} dan sekarang aktif.`,
            relatedTenantId: tenant.id
          }
        });
      }
      await writePricingAudit(tx, {
        actorId: options.confirmedBy ?? null,
        entity: "invoice",
        entityId: invoiceId,
        action: "PAID",
        before: { status: "OPEN" },
        after: { status: "PAID", paymentId: payment.id, method: payment.method, amount: payment.amount.toFixed(2) } satisfies Prisma.InputJsonObject
      });
      return { invoice: paid, payment, alreadyPaid: false, nextBillingDate, registration: invoice.type === "REGISTRATION", tenantName: tenant.name };
    })
  );

  if (outcome.alreadyPaid) return { invoice: outcome.invoice, payment: outcome.payment, alreadyPaid: true };

  // Outside the transaction: the new status must be visible before anything is cached again.
  clearEntitlementCache(outcome.invoice.tenantId);
  const contact = await findBillingContact(outcome.invoice.tenantId);
  if (contact) {
    await sendReceiptEmail({
      to: contact.email,
      adminName: contact.name,
      tenantName: outcome.tenantName,
      invoiceId,
      invoiceNumber: outcome.invoice.number,
      total: outcome.invoice.total.toFixed(2),
      paidAt: now,
      nextBillingDate: outcome.nextBillingDate,
      registration: outcome.registration
    });
  }
  return { invoice: outcome.invoice, payment: outcome.payment, alreadyPaid: false };
}
