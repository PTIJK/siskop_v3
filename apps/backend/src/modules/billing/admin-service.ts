import type { Invoice, Payment, Prisma, Tenant, TenantSubscription } from "@prisma/client";
import type { MarkInvoicePaidResult, PlatformInvoice, PlatformInvoiceDetail, PlatformInvoiceList } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound } from "../../lib/errors.js";
import { confirmPayment } from "../../lib/payments/confirm.js";
import { findBillingContact } from "../../lib/payments/emails.js";
import { writePricingAudit } from "../../lib/pricing/audit.js";
import { getPublishedCatalog } from "../../lib/pricing/catalog.js";
import type { SubscriptionSnapshot } from "../../lib/pricing/engine.js";
import { allocateInvoiceNumber } from "../../lib/pricing/invoice.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { sendInvoiceEmail } from "../onboarding/invoice-email.js";
import type { InvoiceListQuery, MarkPaidInput } from "./admin-schema.js";

type Row = Invoice & {
  tenant: Pick<Tenant, "id" | "name" | "slug">;
  subscription: Pick<TenantSubscription, "snapshot" | "billingCycle">;
  payments: Payment[];
};

const include = {
  tenant: { select: { id: true, name: true, slug: true } },
  subscription: { select: { snapshot: true, billingCycle: true } },
  payments: { orderBy: { paidAt: "asc" } }
} satisfies Prisma.InvoiceInclude;

const packageNameOf = (row: Pick<Row, "subscription">) => (row.subscription.snapshot as unknown as SubscriptionSnapshot).packageName;

function toRow(row: Row): PlatformInvoice {
  const payment = row.payments[0];
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    tenant: row.tenant,
    packageName: packageNameOf(row),
    billingCycle: row.subscription.billingCycle,
    subtotal: row.subtotal.toFixed(2),
    taxRate: row.taxRate === null ? null : row.taxRate.toFixed(4),
    taxAmount: row.taxAmount.toFixed(2),
    total: row.total.toFixed(2),
    dueDate: row.dueDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    paidAt: payment ? payment.paidAt.toISOString() : null,
    paymentMethod: payment ? payment.method : null
  };
}

async function publishedSettings() {
  try {
    return (await getPublishedCatalog()).snapshot.settings;
  } catch {
    return null;
  }
}

async function loadDetail(id: string): Promise<PlatformInvoiceDetail> {
  const row = await withoutTenantScope(async () => db.invoice.findUnique({ where: { id }, include }));
  if (!row) throw notFound("Invoice not found");
  return {
    ...toRow(row),
    payments: row.payments.map((p) => ({
      id: p.id,
      method: p.method,
      reference: p.gatewayTxnId,
      amount: p.amount.toFixed(2),
      paidAt: p.paidAt.toISOString()
    })),
    paymentInstructions: (await publishedSettings())?.paymentInstructions ?? null
  };
}

export async function listInvoices(query: InvoiceListQuery): Promise<PlatformInvoiceList> {
  const where: Prisma.InvoiceWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    ...(query.q
      ? { OR: [{ number: { contains: query.q, mode: "insensitive" } }, { tenant: { name: { contains: query.q, mode: "insensitive" } } }] }
      : {})
  };
  const [total, rows] = await withoutTenantScope(async () =>
    Promise.all([
      db.invoice.count({ where }),
      db.invoice.findMany({
        where,
        include,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      })
    ])
  );
  return { items: rows.map(toRow), total, page: query.page, pageSize: query.pageSize };
}

export const getInvoice = loadDetail;

export async function markInvoicePaid(actorId: string, id: string, input: MarkPaidInput): Promise<MarkInvoicePaidResult> {
  const result = await confirmPayment(id, {
    method: input.method,
    gatewayTxnId: input.reference ?? null,
    confirmedBy: actorId,
    ...(input.paidAt ? { now: input.paidAt } : {})
  });
  return { invoice: await loadDetail(id), alreadyPaid: result.alreadyPaid };
}

/** Cancels an unpaid invoice. Void stays void; a paid invoice cannot be voided. */
export async function voidInvoice(actorId: string, id: string): Promise<{ invoice: PlatformInvoiceDetail }> {
  await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) throw notFound("Invoice not found");
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (invoice.status === "VOID") return;
      if (invoice.status === "PAID") throw conflict(`Invoice ${invoice.number} is paid and cannot be voided`);
      await tx.invoice.update({ where: { id, tenantId: invoice.tenantId }, data: { status: "VOID" } });
      await writePricingAudit(tx, { actorId, entity: "invoice", entityId: id, action: "VOIDED", before: { status: invoice.status }, after: { status: "VOID" } });
    })
  );
  return { invoice: await loadDetail(id) };
}

/**
 * Replaces an unpaid registration invoice (open or expired) with a copy that
 * has a new number and a fresh payment deadline, so a koperasi that is about to
 * be purged can still pay. The old one is voided in the same transaction.
 */
export async function reissueInvoice(actorId: string, id: string): Promise<{ invoice: PlatformInvoiceDetail }> {
  const settings = await publishedSettings();
  const purgeDays = settings?.unpaidRegistrationPurgeDays ?? 14;

  const created = await withoutTenantScope(async () =>
    db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Invoice" WHERE "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) throw notFound("Invoice not found");
      const old = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (old.type !== "REGISTRATION") {
        throw conflict("Only a registration invoice can be reissued; void a renewal and the next billing run issues a new one");
      }
      if (old.status !== "OPEN" && old.status !== "EXPIRED") throw conflict(`Invoice ${old.number} is ${old.status.toLowerCase()} and cannot be reissued`);

      const now = new Date();
      await tx.invoice.update({ where: { id, tenantId: old.tenantId }, data: { status: "VOID" } });
      const fresh = await tx.invoice.create({
        data: {
          tenantId: old.tenantId,
          subscriptionId: old.subscriptionId,
          number: await allocateInvoiceNumber(tx, now),
          type: old.type,
          subtotal: old.subtotal,
          taxRate: old.taxRate,
          taxAmount: old.taxAmount,
          total: old.total,
          dueDate: new Date(now.getTime() + purgeDays * 86_400_000)
        }
      });
      await writePricingAudit(tx, {
        actorId,
        entity: "invoice",
        entityId: id,
        action: "REISSUED",
        before: { status: old.status, number: old.number },
        after: { status: "VOID", replacedBy: fresh.number }
      });
      return fresh;
    })
  );

  // Best effort, like the original mail: the owner's screen shows the new invoice either way.
  await mailReissued(created.id, settings?.paymentInstructions ?? null);
  return { invoice: await loadDetail(created.id) };
}

async function mailReissued(invoiceId: string, paymentInstructions: string | null): Promise<void> {
  const row = await withoutTenantScope(async () => db.invoice.findUnique({ where: { id: invoiceId }, include }));
  if (!row) return;
  const contact = await findBillingContact(row.tenantId);
  if (!contact) return;
  await sendInvoiceEmail({
    to: contact.email,
    adminName: contact.name,
    tenantName: row.tenant.name,
    packageName: packageNameOf(row),
    billingCycle: row.subscription.billingCycle,
    invoiceId: row.id,
    invoiceNumber: row.number,
    subtotal: row.subtotal.toFixed(2),
    taxRate: row.taxRate === null ? null : row.taxRate.toString(),
    taxAmount: row.taxAmount.toFixed(2),
    total: row.total.toFixed(2),
    dueDate: row.dueDate,
    paymentInstructions
  });
}
