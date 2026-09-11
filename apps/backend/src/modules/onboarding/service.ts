import bcrypt from "bcryptjs";
import { addMonths } from "date-fns";
import { Prisma } from "@prisma/client";
import type { OnboardingStatus, PackageCatalog } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound, unauthorized } from "../../lib/errors.js";
import { provisionTenantInTx } from "../tenants/provision.js";
import { verifyFirebaseIdentity } from "./firebase.js";
import { sessionFor } from "../auth/service.js";
import { registrationSchema, resumeSchema, firebaseSignInSchema } from "./schema.js";
import {
  checkoutConfigured,
  createPaymentSession,
  getPaymentSession,
  ProviderRequestError,
  validateProviderSession
} from "./xendit.js";

export async function catalog(): Promise<PackageCatalog> {
  const packages = await db.subscriptionPackage.findMany({
    where: { isActive: true, price: { gt: 0 } },
    orderBy: [{ price: "asc" }, { id: "asc" }]
  });
  return {
    checkoutAvailable: checkoutConfigured(),
    packages: packages
      .filter((p) => p.price.isInteger())
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price.toString(),
        modules: p.modules.filter((m): m is "accounting" => m === "accounting"),
        maxUsers: p.maxUsers,
        maxMembers: p.maxMembers,
        maxSavingConfigs: p.maxSavingConfigs,
        whitelabelEnabled: p.whitelabelEnabled
      }))
  };
}
export async function register(input: unknown): Promise<string> {
  const data = registrationSchema.parse(input);
  if (!checkoutConfigured()) throw conflict("Pembayaran belum tersedia. Silakan coba kembali nanti.");
  const pkg = await db.subscriptionPackage.findUnique({ where: { id: data.packageId } });
  if (!pkg?.isActive || !pkg.price.gt(0) || !pkg.price.isInteger()) throw notFound("Paket tidak tersedia");
  const identity = await verifyFirebaseIdentity(data.idToken);
  try {
    return await db.$transaction(async (tx) => {
      const { tenant, roles } = await provisionTenantInTx(tx, {
        name: data.tenantName,
        slug: data.slug,
        registrationNo: data.registrationNo,
        address: data.address,
        type: data.type,
        cooperativeType: data.firstUnit.type,
        firstUnit: data.firstUnit
      });
      await tx.tenant.update({ where: { id: tenant.id }, data: { isActive: false, packageId: pkg.id } });
      const role = roles.find((r) => r.name === "Super Admin");
      if (!role) throw new Error("Missing provisioned admin role");
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          roleId: role.id,
          name: data.adminName,
          email: identity.email,
          firebaseUid: identity.uid,
          authProvider: identity.provider
        }
      });
      const order = await tx.onboardingOrder.create({
        data: {
          tenantId: tenant.id,
          adminId: user.id,
          packageId: pkg.id,
          packageName: pkg.name,
          amount: pkg.price
        }
      });
      return order.id;
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
export async function resume(input: unknown): Promise<string> {
  const data = resumeSchema.parse(input);
  const tenant = await db.tenant.findUnique({
    where: { slug: data.slug },
    include: { onboardingOrder: true }
  });
  const user = tenant
    ? await db.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: data.email } } })
    : null;
  const valid = await bcrypt.compare(
    data.password,
    user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva"
  );
  if (!user?.isActive || !valid || !tenant?.onboardingOrder || tenant.onboardingOrder.adminId !== user.id)
    throw unauthorized("Data pendaftaran tidak cocok");
  return tenant.onboardingOrder.id;
}
export async function status(orderId: string): Promise<OnboardingStatus> {
  const order = await db.onboardingOrder.findUnique({
    where: { id: orderId },
    include: { tenant: true, attempts: { orderBy: { createdAt: "desc" }, take: 1 } }
  });
  if (!order) throw notFound("Pendaftaran tidak ditemukan");
  const checkout = order.attempts[0];
  return {
    id: order.id,
    status: order.status as OnboardingStatus["status"],
    tenantName: order.tenant.name,
    slug: order.tenant.slug,
    packageName: order.packageName,
    amount: order.amount.toString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    checkout: checkout
      ? {
          status: checkout.status as NonNullable<OnboardingStatus["checkout"]>["status"],
          url: checkout.paymentUrl,
          expiresAt: checkout.expiresAt?.toISOString() ?? null
        }
      : null
  };
}
// A row lock serializes checkout creation across processes and duplicate clicks.
// Never hold a DB transaction open during provider network requests.
export async function checkout(orderId: string): Promise<OnboardingStatus> {
  if (!checkoutConfigured()) throw conflict("Pembayaran belum tersedia. Silakan coba kembali nanti.");
  const reservation = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OnboardingOrder" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.onboardingOrder.findUnique({
      where: { id: orderId },
      include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } }
    });
    if (!order) throw notFound();
    if (order.status === "PAID") return null;
    const latest = order.attempts[0];
    if (latest && ["CREATING", "ACTIVE"].includes(latest.status)) return null;
    const attempt = await tx.checkoutAttempt.create({ data: { orderId } });
    return { attempt, order };
  });
  if (!reservation) return status(orderId);
  const { attempt, order } = reservation;
  const user = await db.user.findFirstOrThrow({ where: { id: order.adminId, tenantId: order.tenantId } });
  try {
    const session = await createPaymentSession({
      id: attempt.id,
      orderId,
      amount: order.amount.toString(),
      packageName: order.packageName,
      name: user.name,
      email: user.email
    });
    await applySession(attempt.id, session);
  } catch (error) {
    // Only definitive provider rejection is retryable. A timeout could mean the
    // charge was created: leave CREATING until a webhook/operator reconciles it.
    if (error instanceof ProviderRequestError && error.definitive) {
      await db.checkoutAttempt.updateMany({
        where: { id: attempt.id, status: "CREATING" },
        data: { status: "FAILED" }
      });
    }
    throw conflict("Tautan pembayaran belum dapat dikonfirmasi. Periksa status sebelum mencoba lagi.");
  }
  return status(orderId);
}
export async function handleSessionWebhook(referenceId: string, sessionId: string): Promise<void> {
  // The dashboard sends sample references, and this account may serve other apps.
  // Acknowledge unrelated sessions without changing an order or fetching provider data.
  const attempt = await db.checkoutAttempt.findUnique({ where: { id: referenceId }, select: { id: true } });
  if (!attempt) return;
  // Checkout attempts exist before calling Xendit, so this also recovers CREATING
  // attempts whose provider response timed out. applySession validates every match.
  await applySession(attempt.id, await getPaymentSession(sessionId));
}
export async function applySession(attemptId: string, value: unknown): Promise<void> {
  await db.$transaction(async (tx) => {
    const attempt = await tx.checkoutAttempt.findUnique({
      where: { id: attemptId },
      include: { order: true }
    });
    if (!attempt) throw notFound("Checkout not found");
    const session = validateProviderSession(value, {
      id: attempt.id,
      providerSessionId: attempt.providerSessionId,
      amount: attempt.order.amount.toString()
    });
    // A completed payment wins over expired/out-of-order callbacks forever.
    await tx.checkoutAttempt.updateMany({
      where: { id: attempt.id, status: { not: "COMPLETED" } },
      data: {
        status: session.status,
        providerSessionId: session.payment_session_id,
        ...(session.payment_link_url ? { paymentUrl: session.payment_link_url } : {}),
        ...(session.expires_at ? { expiresAt: new Date(session.expires_at) } : {})
      }
    });
    if (session.status !== "COMPLETED") return;
    const paidAt = new Date();
    const activated = await tx.onboardingOrder.updateMany({
      where: { id: attempt.orderId, status: "PENDING" },
      data: { status: "PAID", paidAt }
    });
    if (activated.count) {
      await tx.tenant.update({
        where: { id: attempt.order.tenantId },
        data: { isActive: true, packageId: attempt.order.packageId, nextBillingDate: addMonths(paidAt, 1) }
      });
    }
  });
}
export async function reconcile(orderId: string): Promise<OnboardingStatus> {
  const order = await db.onboardingOrder.findUnique({
    where: { id: orderId },
    include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } }
  });
  if (!order) throw notFound();
  const latest = order.attempts[0];
  if (
    order.status !== "PAID" &&
    latest?.providerSessionId &&
    ["ACTIVE", "CREATING"].includes(latest.status)
  ) {
    try {
      await applySession(latest.id, await getPaymentSession(latest.providerSessionId));
    } catch {
      throw conflict("Status pembayaran belum dapat diperbarui. Silakan coba lagi.");
    }
  }
  return status(orderId);
}
export async function complete(orderId: string) {
  const order = await db.onboardingOrder.findUnique({ where: { id: orderId }, include: { tenant: true } });
  if (!order || order.status !== "PAID" || !order.tenant.isActive)
    throw conflict("Pembayaran belum terverifikasi");
  const user = await db.user.findFirst({
    where: { id: order.adminId, tenantId: order.tenantId, isActive: true },
    include: { role: true }
  });
  if (!user) throw unauthorized();
  return { next: "login" as const };
}

// Firebase UID is globally unique. Tenant scope comes from this verified binding,
// never an email address, workspace supplied by the client, or token custom claims.
export async function firebaseSignIn(input: unknown, resumeOnly = false) {
  const { idToken } = firebaseSignInSchema.parse(input);
  const identity = await verifyFirebaseIdentity(idToken);
  const user = await db.user.findUnique({
    where: { firebaseUid: identity.uid },
    include: { role: true, unitAssignments: true }
  });
  if (!user?.isActive) throw unauthorized("Akun belum terdaftar di SISKOP atau tidak aktif.");
  const tenant = await db.tenant.findUnique({ where: { id: user.tenantId }, include: { onboardingOrder: true } });
  if (!tenant) throw unauthorized();
  const order = tenant.onboardingOrder;
  if (order?.status === "PENDING" || resumeOnly) {
    if (!order || order.adminId !== user.id) throw unauthorized("Pendaftaran tidak ditemukan.");
    return { next: "checkout" as const, order: await status(order.id) };
  }
  if (!tenant.isActive) throw unauthorized("Koperasi tidak aktif.");
  const session = await sessionFor(user, identity.authTime);
  await db.user.update({ where: { id: user.id, tenantId: user.tenantId }, data: { lastLoginAt: new Date() } });
  return { next: "dashboard" as const, session };
}
