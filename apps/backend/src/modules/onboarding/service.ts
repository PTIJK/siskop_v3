import { randomBytes } from "node:crypto";
import { addDays } from "date-fns";
import { Prisma } from "@prisma/client";
import type { RegistrationStatus } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound, unauthorized } from "../../lib/errors.js";
import { getPublishedCatalog } from "../../lib/pricing/catalog.js";
import { buildSubscriptionSnapshot, quote } from "../../lib/pricing/engine.js";
import { createInvoice } from "../../lib/pricing/invoice.js";
import { assertFirstUnitAllowed } from "../../lib/pricing/unit-rules.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { sessionFor } from "../auth/service.js";
import { tenantDomainsEnabled, tenantLoginUrl } from "../tenant-domains/config.js";
import { provisionTenantInTx } from "../tenants/provision.js";
import { verifyFirebaseIdentity } from "./firebase.js";
import { sendInvoiceEmail, type InvoiceEmailData } from "./invoice-email.js";
import { firebaseSignInSchema, registrationSchema } from "./schema.js";

/** How long the registration response waits for the invoice email before moving on. */
const EMAIL_WAIT_MS = 3000;

function workspaceSlug(tenantName: string, requested: string | undefined): string {
  const fromName =
    tenantName
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/g, "") || "koperasi";
  const generated = `${fromName}-${randomBytes(6).toString("hex")}`;
  return tenantDomainsEnabled() ? generated : (requested ?? generated);
}

/**
 * Creates the koperasi, its first admin, its subscription and, when money is
 * owed, its first invoice, all in one transaction. The package arrives as a
 * selection: the price is recomputed here from the published catalog, and
 * a request that names a price is rejected by the schema before this runs.
 *
 * A registration that costs nothing is active at once. One that costs anything
 * (a paid package, or a free package with a paid support plan) leaves the
 * koperasi inactive and the subscription PENDING_PAYMENT until an invoice is paid.
 */
async function createRegistration(input: unknown): Promise<{ tenantId: string; invoiceEmail: InvoiceEmailData | null }> {
  const data = registrationSchema.parse(input);
  const published = await getPublishedCatalog();
  const priced = quote(data.subscription, published, { publicOnly: true });
  const snapshot = buildSubscriptionSnapshot(data.subscription, published, { publicOnly: true });
  const firstUnit = data.firstUnit ?? { type: "KSP" as const, name: "Simpan pinjam" };
  assertFirstUnitAllowed(firstUnit.type, priced.effectiveFeatures);

  const identity = await verifyFirebaseIdentity(data.idToken);
  const slug = workspaceSlug(data.tenantName, data.slug);
  const free = new Prisma.Decimal(priced.subtotal).isZero();
  const settings = published.snapshot.settings;

  try {
    return await db.$transaction(async (tx) => {
      const pkg = await tx.subscriptionPackage.findUniqueOrThrow({ where: { code: data.subscription.packageCode } });
      const supportPlan = data.subscription.supportPlanCode
        ? await tx.supportPlan.findUnique({ where: { code: data.subscription.supportPlanCode } })
        : null;

      const { tenant, roles } = await provisionTenantInTx(tx, {
        name: data.tenantName,
        slug,
        registrationNo: data.registrationNo,
        address: data.address,
        type: data.type,
        cooperativeType: firstUnit.type,
        firstUnit
      });
      await tx.tenant.update({ where: { id: tenant.id }, data: { isActive: free, packageId: pkg.id } });

      const role = roles.find((r) => r.name === "Super Admin");
      if (!role) throw new Error("Missing provisioned admin role");
      await tx.user.create({
        data: {
          tenantId: tenant.id,
          roleId: role.id,
          name: data.adminName,
          email: identity.email,
          firebaseUid: identity.uid,
          authProvider: identity.provider
        }
      });

      const subscription = await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          packageId: pkg.id,
          pricingVersion: published.version,
          billingCycle: data.subscription.billingCycle,
          supportPlanId: supportPlan?.id ?? null,
          selectedFeatureKeys: data.subscription.featureKeys ?? [],
          addons: Object.fromEntries((data.subscription.addons ?? []).map((a) => [a.itemKey, a.qty])),
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          amountPerCycle: new Prisma.Decimal(priced.amountPerCycle),
          status: free ? "ACTIVE" : "PENDING_PAYMENT",
          startsAt: new Date(),
          createdVia: "REGISTRATION"
        }
      });
      if (free) return { tenantId: tenant.id, invoiceEmail: null };

      const invoice = await createInvoice(tx, {
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        type: "REGISTRATION",
        quote: priced,
        dueDate: addDays(new Date(), settings.unpaidRegistrationPurgeDays)
      });
      return {
        tenantId: tenant.id,
        invoiceEmail: {
          to: identity.email,
          adminName: data.adminName,
          tenantName: data.tenantName,
          packageName: snapshot.packageName,
          billingCycle: data.subscription.billingCycle,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          subtotal: invoice.subtotal.toString(),
          taxRate: invoice.taxRate?.toString() ?? null,
          taxAmount: invoice.taxAmount.toString(),
          total: invoice.total.toString(),
          dueDate: invoice.dueDate,
          paymentInstructions: settings.paymentInstructions
        }
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict(
        "Akun, alamat workspace, atau nomor badan hukum sudah terdaftar. Gunakan Lanjutkan pendaftaran jika sebelumnya sudah mendaftar."
      );
    }
    throw error;
  }
}

/** Registers a koperasi and returns its tenant id. The invoice email is sent but never blocks or fails the registration. */
export async function register(input: unknown): Promise<string> {
  const { tenantId, invoiceEmail } = await createRegistration(input);
  if (invoiceEmail) {
    await Promise.race([sendInvoiceEmail(invoiceEmail), new Promise<void>((resolve) => setTimeout(resolve, EMAIL_WAIT_MS))]);
  }
  return tenantId;
}

/** Where a registration stands: the plan, the invoice awaiting payment and how to pay it. */
export async function status(tenantId: string): Promise<RegistrationStatus> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, include: { subscription: true } });
  if (!tenant?.subscription) throw notFound("Pendaftaran tidak ditemukan");
  const sub = tenant.subscription;

  const invoice = await db.invoice.findFirst({ where: { tenantId, type: "REGISTRATION" }, orderBy: { createdAt: "desc" } });
  // Instructions come from the published settings so the owner can correct them without reissuing an invoice.
  const instructions =
    invoice?.status === "OPEN" ? await getPublishedCatalog().then((c) => c.snapshot.settings.paymentInstructions, () => null) : null;

  return {
    tenantName: tenant.name,
    slug: tenant.slug,
    status: sub.status,
    packageName: (sub.snapshot as { packageName?: string }).packageName ?? "",
    billingCycle: sub.billingCycle,
    invoice: invoice
      ? {
          number: invoice.number,
          subtotal: invoice.subtotal.toString(),
          taxRate: invoice.taxRate?.toString() ?? null,
          taxAmount: invoice.taxAmount.toString(),
          total: invoice.total.toString(),
          status: invoice.status,
          dueDate: invoice.dueDate.toISOString()
        }
      : null,
    paymentInstructions: instructions,
    ...(sub.status === "ACTIVE" && tenantDomainsEnabled() ? { loginUrl: tenantLoginUrl(tenant.slug) } : {})
  };
}

/**
 * Firebase UID is globally unique. Tenant scope comes from this verified binding,
 * never an email address, workspace supplied by the client, or token custom claims.
 *
 * A koperasi still waiting for payment cannot sign in: the result is its status,
 * and the route sets the registration cookie so the status page can be reloaded.
 */
export async function firebaseSignIn(input: unknown, resumeOnly = false, expectedTenantId?: string) {
  const { idToken } = firebaseSignInSchema.parse(input);
  const identity = await verifyFirebaseIdentity(idToken);
  const where = {
    identity: { firebaseUid: identity.uid, isActive: true },
    ...(expectedTenantId ? { tenantId: expectedTenantId } : {}),
    isActive: true
  };
  const user = resumeOnly
    ? // Recovery resolves the administrator of a self-registered koperasi, even when the
      // identity also has active memberships elsewhere. A regular membership grants nothing here.
      await withoutTenantScope(() =>
        db.user.findFirst({
          where: { ...where, role: { name: "Super Admin" }, tenant: { subscription: { createdVia: "REGISTRATION" } } },
          include: { role: true, unitAssignments: true }
        })
      )
    : await withoutTenantScope(() => db.user.findFirst({ where, include: { role: true, unitAssignments: true } }));
  if (!user?.isActive) throw unauthorized("Akun belum terdaftar di SISKOP atau tidak aktif.");
  if (expectedTenantId && user.tenantId !== expectedTenantId) throw unauthorized("Akun ini tidak memiliki akses ke workspace ini.");
  if (expectedTenantId && user.isPlatformAdmin) throw unauthorized("Gunakan situs pusat untuk akun admin platform.");

  const tenant = await db.tenant.findUnique({ where: { id: user.tenantId }, include: { subscription: true } });
  if (!tenant) throw unauthorized();
  if (tenant.subscription?.status === "PENDING_PAYMENT" || resumeOnly) {
    return { next: "awaiting_payment" as const, tenantId: tenant.id, status: await status(tenant.id) };
  }
  if (!tenant.isActive) throw unauthorized("Koperasi tidak aktif.");
  const session = await sessionFor(user, identity.authTime);
  await db.user.update({ where: { id: user.id, tenantId: user.tenantId }, data: { lastLoginAt: new Date() } });
  return { next: "dashboard" as const, session };
}
