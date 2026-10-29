import type { BillingCycle, SubscriptionStatus } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { clearCatalogCache, getPublishedCatalog } from "../src/lib/pricing/catalog.js";
import { buildSubscriptionSnapshot, quote } from "../src/lib/pricing/engine.js";
import { createInvoice } from "../src/lib/pricing/invoice.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { provisionTenant } from "../src/modules/tenants/provision.js";
import { seedJson } from "./pricing-fixture.js";

export const BILLING_PREFIX = "BILL-TEST";

export async function resetCatalog() {
  await withoutTenantScope(async () => db.invoice.deleteMany({}));
  await withoutTenantScope(async () => db.tenantSubscription.deleteMany({}));
  await db.packageFeature.deleteMany({});
  await db.feature.deleteMany({});
  await db.subscriptionPackage.deleteMany({ where: { code: { not: null } } });
  await db.volumeAddon.deleteMany({});
  await db.supportPlan.deleteMany({});
  await db.pricingSetting.deleteMany({});
  await db.pricingVersion.deleteMany({});
  await db.pricingAuditLog.deleteMany({});
}

/** Loads the shipped seed (VAT off unless asked) and publishes it as version 1. */
export async function seedCatalog({ withVat = false }: { withVat?: boolean } = {}) {
  await resetCatalog();
  await loadPricingSeed(db, parsePricingSeed(seedJson({ withVat })));
  clearCatalogCache();
}

export async function cleanBilling() {
  await db.notification.deleteMany({ where: { relatedTenant: { registrationNo: { startsWith: BILLING_PREFIX } } } });
  await db.tenant.deleteMany({ where: { registrationNo: { startsWith: BILLING_PREFIX } } });
}

export interface TenantFixtureOptions {
  tag: string;
  packageCode?: string;
  cycle?: BillingCycle;
  supportPlanCode?: string;
  status?: SubscriptionStatus;
  startsAt?: Date;
  nextBillingDate?: Date | null;
  createdVia?: "REGISTRATION" | "ADMIN" | "MIGRATION";
  /** Null for none. Defaults to an OPEN REGISTRATION invoice due in 14 days. */
  invoice?: { type?: "REGISTRATION" | "RENEWAL" | "ADDON" | "SUPPORT"; dueDate?: Date; status?: "OPEN" | "PAID" | "EXPIRED" | "VOID" } | null;
  isActive?: boolean;
}

/** A tenant with a stored subscription (and usually an invoice), built from the same lib calls the services use. */
export async function makeSubscribedTenant(opts: TenantFixtureOptions) {
  const published = await getPublishedCatalog();
  const selection = {
    packageCode: opts.packageCode ?? "small",
    billingCycle: opts.cycle ?? ("MONTHLY" as BillingCycle),
    ...(opts.supportPlanCode ? { supportPlanCode: opts.supportPlanCode } : {})
  };
  const priced = quote(selection, published);
  const { tenant, roles } = await provisionTenant({
    name: `Koperasi ${opts.tag}`,
    slug: `bill-${opts.tag.toLowerCase()}`,
    registrationNo: `${BILLING_PREFIX}-${opts.tag}`,
    address: "Jl. Uji 1",
    type: "KONVENSIONAL",
    firstUnit: { type: "KSP", name: "Simpan pinjam" }
  });
  const pkg = await db.subscriptionPackage.findUniqueOrThrow({ where: { code: selection.packageCode } });
  const supportPlan = opts.supportPlanCode ? await db.supportPlan.findUniqueOrThrow({ where: { code: opts.supportPlanCode } }) : null;
  await db.tenant.update({ where: { id: tenant.id }, data: { isActive: opts.isActive ?? opts.status === "ACTIVE", packageId: pkg.id } });
  const role = roles.find((r) => r.name === "Super Admin");
  if (!role) throw new Error("Missing Super Admin role");
  const admin = await db.user.create({
    data: { tenantId: tenant.id, roleId: role.id, name: `Admin ${opts.tag}`, email: `admin-${opts.tag.toLowerCase()}@bill-test.example` }
  });
  const subscription = await db.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      packageId: pkg.id,
      pricingVersion: published.version,
      billingCycle: selection.billingCycle,
      supportPlanId: supportPlan?.id ?? null,
      snapshot: buildSubscriptionSnapshot(selection, published) as never,
      amountPerCycle: priced.amountPerCycle,
      status: opts.status ?? "PENDING_PAYMENT",
      startsAt: opts.startsAt ?? new Date(),
      nextBillingDate: opts.nextBillingDate ?? null,
      createdVia: opts.createdVia ?? "REGISTRATION"
    }
  });
  const spec = opts.invoice === undefined ? {} : opts.invoice;
  const invoice =
    spec === null
      ? null
      : await db.$transaction(async (tx) => {
          const made = await createInvoice(tx, {
            tenantId: tenant.id,
            subscriptionId: subscription.id,
            type: spec.type ?? "REGISTRATION",
            quote: priced,
            dueDate: spec.dueDate ?? new Date(Date.now() + 14 * 86_400_000)
          });
          return spec.status && spec.status !== "OPEN" ? tx.invoice.update({ where: { id: made.id, tenantId: tenant.id }, data: { status: spec.status } }) : made;
        });
  return { tenant, subscription, invoice, admin, priced };
}

export const subscriptionOf = (tenantId: string) =>
  withoutTenantScope(async () => db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } }));
export const invoicesOf = (tenantId: string) =>
  withoutTenantScope(async () => db.invoice.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }));
export const paymentsOf = (tenantId: string) =>
  withoutTenantScope(async () => db.payment.findMany({ where: { tenantId } }));

export const DAY = 86_400_000;
export const daysFrom = (base: Date, days: number) => new Date(base.getTime() + days * DAY);
