import type { BillingJobsResult } from "@siskop/types";
import { db } from "../../lib/db.js";
import { findBillingContact, sendRenewalEmail } from "../../lib/payments/emails.js";
import { getPublishedCatalog } from "../../lib/pricing/catalog.js";
import { clearEntitlementCache } from "../../lib/pricing/entitlements.js";
import { createInvoice } from "../../lib/pricing/invoice.js";
import { renewalAmounts } from "../../lib/pricing/renewal.js";
import type { CatalogSnapshot } from "../../lib/pricing/snapshot.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";

const DAY = 86_400_000;
/** The renewal invoice is issued this long before the billing date. */
const ISSUE_DAYS_BEFORE = 30;
/** The reminder goes out once the due date is this close. */
const REMINDER_DAYS_BEFORE = 7;

type Settings = Pick<CatalogSnapshot["settings"], "paymentGraceDays" | "taxRate" | "paymentInstructions">;

/** The owner's published settings; sensible defaults before the first publish so the job never needs a catalog to run. */
async function loadSettings(): Promise<Settings> {
  try {
    return (await getPublishedCatalog()).snapshot.settings;
  } catch {
    console.warn("Billing jobs: no published pricing catalog, using defaults");
    return { paymentGraceDays: 7, taxRate: null, paymentInstructions: null };
  }
}

/**
 * Yearly support fee as it stood in the catalog version the tenant subscribed
 * under, so a later price change does not reach an existing subscription.
 */
async function supportYearlyCost(
  sub: { pricingVersion: number; supportPlan: { code: string; yearlyCost: { toString(): string } } | null },
  versions: Map<number, CatalogSnapshot | null>
): Promise<string | null> {
  if (!sub.supportPlan) return null;
  if (!versions.has(sub.pricingVersion)) {
    const row = await db.pricingVersion.findUnique({ where: { version: sub.pricingVersion } });
    versions.set(sub.pricingVersion, row ? (row.snapshot as unknown as CatalogSnapshot) : null);
  }
  const frozen = versions.get(sub.pricingVersion)?.supportPlans.find((p) => p.code === sub.supportPlan?.code);
  return frozen?.yearlyCost ?? sub.supportPlan.yearlyCost.toString();
}

async function issueRenewals(asOf: Date, settings: Settings): Promise<BillingJobsResult["renewals"]> {
  const result = { checked: 0, created: 0, failed: 0 };
  const versions = new Map<number, CatalogSnapshot | null>();
  const due = await withoutTenantScope(async () =>
    db.tenantSubscription.findMany({
      where: { status: { in: ["ACTIVE", "PAST_DUE"] }, nextBillingDate: { lte: new Date(asOf.getTime() + ISSUE_DAYS_BEFORE * DAY) } },
      include: { supportPlan: true }
    })
  );
  for (const sub of due) {
    result.checked += 1;
    try {
      const support = await supportYearlyCost(sub, versions);
      const created = await withoutTenantScope(async () =>
        db.$transaction(async (tx) => {
          // Two runs at once queue here, so a billing date gets one invoice.
          await tx.$queryRaw`SELECT "id" FROM "TenantSubscription" WHERE "id" = ${sub.id} FOR UPDATE`;
          const fresh = await tx.tenantSubscription.findUniqueOrThrow({ where: { id: sub.id } });
          const dueDate = fresh.nextBillingDate;
          if (!dueDate || (fresh.status !== "ACTIVE" && fresh.status !== "PAST_DUE")) return false;
          const existing = await tx.invoice.findFirst({
            where: { tenantId: fresh.tenantId, subscriptionId: fresh.id, type: "RENEWAL", dueDate, status: { not: "VOID" } },
            select: { id: true }
          });
          if (existing) return false;
          const amounts = renewalAmounts(fresh, dueDate, support, settings.taxRate);
          if (Number(amounts.subtotal) === 0) return false;
          await createInvoice(tx, { tenantId: fresh.tenantId, subscriptionId: fresh.id, type: "RENEWAL", quote: amounts, dueDate, now: asOf });
          return true;
        })
      );
      if (created) result.created += 1;
    } catch (error) {
      result.failed += 1;
      console.error("Renewal invoice failed", { subscriptionId: sub.id, error });
    }
  }
  return result;
}

/** The invoice mail at issue time and one reminder inside the last week; each is sent once. */
async function sendNotices(asOf: Date, settings: Settings): Promise<BillingJobsResult["notices"]> {
  const result = { checked: 0, sent: 0, failed: 0 };
  const open = await withoutTenantScope(async () =>
    db.invoice.findMany({ where: { type: "RENEWAL", status: "OPEN", noticeStage: { lt: 2 } }, include: { tenant: { select: { name: true } } } })
  );
  for (const invoice of open) {
    const target = invoice.dueDate.getTime() - asOf.getTime() <= REMINDER_DAYS_BEFORE * DAY ? 2 : 1;
    if (invoice.noticeStage >= target) continue;
    result.checked += 1;
    try {
      const contact = await findBillingContact(invoice.tenantId);
      if (!contact) continue;
      const sent = await sendRenewalEmail({
        to: contact.email,
        adminName: contact.name,
        tenantName: invoice.tenant.name,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        subtotal: invoice.subtotal.toFixed(2),
        taxRate: invoice.taxRate === null ? null : invoice.taxRate.toString(),
        taxAmount: invoice.taxAmount.toFixed(2),
        total: invoice.total.toFixed(2),
        dueDate: invoice.dueDate,
        paymentInstructions: settings.paymentInstructions,
        kind: target === 2 ? "reminder" : "issued"
      });
      if (!sent) continue;
      await withoutTenantScope(async () => db.invoice.update({ where: { id: invoice.id, tenantId: invoice.tenantId }, data: { noticeStage: target } }));
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      console.error("Renewal notice failed", { invoiceId: invoice.id, error });
    }
  }
  return result;
}

/**
 * ACTIVE -> PAST_DUE once a renewal invoice stays unpaid beyond the grace
 * period. This only records the state and tells the owners; refusing access is
 * the enforcement layer's decision, and confirmPayment lifts the state again.
 */
async function markPastDue(asOf: Date, settings: Settings): Promise<BillingJobsResult["pastDue"]> {
  const result = { checked: 0, marked: 0, failed: 0 };
  const cutoff = new Date(asOf.getTime() - settings.paymentGraceDays * DAY);
  const subs = await withoutTenantScope(async () =>
    db.tenantSubscription.findMany({
      where: { status: "ACTIVE", invoices: { some: { type: "RENEWAL", status: "OPEN", dueDate: { lt: cutoff } } } },
      include: { tenant: { select: { name: true } }, invoices: { where: { type: "RENEWAL", status: "OPEN", dueDate: { lt: cutoff } }, take: 1 } }
    })
  );
  for (const sub of subs) {
    result.checked += 1;
    try {
      const changed = await withoutTenantScope(async () =>
        db.$transaction(async (tx) => {
          const moved = await tx.tenantSubscription.updateMany({ where: { id: sub.id, tenantId: sub.tenantId, status: "ACTIVE" }, data: { status: "PAST_DUE" } });
          if (moved.count === 0) return false;
          await tx.notification.create({
            data: {
              type: "BILLING_BLOCKED",
              title: "Pembayaran terlambat",
              message: `${sub.tenant.name}: faktur ${sub.invoices[0]?.number ?? ""} belum dibayar melewati masa tenggang ${settings.paymentGraceDays} hari.`,
              relatedTenantId: sub.tenantId
            }
          });
          return true;
        })
      );
      if (changed) {
        clearEntitlementCache(sub.tenantId);
        result.marked += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error("Past-due marking failed", { subscriptionId: sub.id, error });
    }
  }
  return result;
}

/**
 * Deletes a koperasi that registered, never paid, and let its registration
 * invoice pass the deadline. Narrow on purpose: only registrations still
 * waiting for their first payment, never an admin-created or migrated tenant,
 * and never one with a paid invoice. Its data is whatever registration
 * provisioned, since a tenant cannot log in before paying.
 */
async function purgeUnpaidRegistrations(asOf: Date): Promise<BillingJobsResult["purge"]> {
  const result = { checked: 0, deleted: 0, failed: 0 };
  const stale = await withoutTenantScope(async () =>
    db.tenantSubscription.findMany({
      where: {
        status: "PENDING_PAYMENT",
        createdVia: "REGISTRATION",
        invoices: { some: { type: "REGISTRATION", status: "OPEN", dueDate: { lt: asOf } }, none: { status: "PAID" } }
      },
      select: { id: true, tenantId: true }
    })
  );
  for (const sub of stale) {
    result.checked += 1;
    try {
      const deleted = await withoutTenantScope(async () =>
        db.$transaction(async (tx) => {
          // A payment being confirmed holds these rows; wait for it, then look again.
          await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "subscriptionId" = ${sub.id} FOR UPDATE`;
          const fresh = await tx.tenantSubscription.findUnique({
            where: { id: sub.id },
            include: { invoices: { select: { status: true } } }
          });
          if (!fresh || fresh.status !== "PENDING_PAYMENT" || fresh.invoices.some((i) => i.status === "PAID")) return false;
          await tx.tenant.delete({ where: { id: sub.tenantId } });
          return true;
        })
      );
      if (deleted) {
        clearEntitlementCache(sub.tenantId);
        result.deleted += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error("Unpaid registration purge failed", { subscriptionId: sub.id, error });
    }
  }
  return result;
}

const failedStep = <T extends { failed: number }>(zero: T) => (error: unknown): T => {
  console.error("Billing job step failed", error);
  return { ...zero, failed: 1 };
};

/**
 * The daily billing tick: renewal invoices, their mail, past-due marking and
 * the purge of unpaid registrations. Each step is independent and re-runnable.
 */
export async function runBillingJobs(asOf: Date = new Date()): Promise<BillingJobsResult> {
  const settings = await loadSettings();
  const renewals = await issueRenewals(asOf, settings).catch(failedStep({ checked: 0, created: 0, failed: 0 }));
  const notices = await sendNotices(asOf, settings).catch(failedStep({ checked: 0, sent: 0, failed: 0 }));
  const pastDue = await markPastDue(asOf, settings).catch(failedStep({ checked: 0, marked: 0, failed: 0 }));
  const purge = await purgeUnpaidRegistrations(asOf).catch(failedStep({ checked: 0, deleted: 0, failed: 0 }));
  return { renewals, notices, pastDue, purge };
}
