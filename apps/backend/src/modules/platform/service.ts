import bcrypt from "bcryptjs";
import type { Prisma, Tenant as DbTenant, SubscriptionPackage as DbPackage } from "@prisma/client";
import type {
  CreatePlatformAdminRequest,
  PlatformAdmin,
  PlatformTenantSummary,
  SubscriptionPackage,
  Tenant,
  UpdatePlatformAdminRequest
} from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound } from "../../lib/errors.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { toPublicUser } from "../../lib/user-mapper.js";
import { provisionTenantInTx } from "../tenants/provision.js";
import {
  createTenantSchema,
  type CreatePackageInput,
  type CreateTenantInput,
  type UpdatePackageInput,
  type UpdateTenantStatusInput
} from "./schema.js";

const BCRYPT_ROUNDS = 10;

function toPublicTenant(tenant: DbTenant): Tenant {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    address: tenant.address,
    registrationNo: tenant.registrationNo,
    type: tenant.type,
    cooperativeType: tenant.cooperativeType,
    logoUrl: tenant.logoUrl,
    isActive: tenant.isActive,
    createdAt: tenant.createdAt.toISOString()
  };
}

export async function listTenants(): Promise<PlatformTenantSummary[]> {
  const tenants = await db.tenant.findMany({
    include: { _count: { select: { units: true, users: true } }, package: true },
    orderBy: { createdAt: "desc" }
  });

  return tenants.map((t) => ({
    ...toPublicTenant(t),
    unitCount: t._count.units,
    userCount: t._count.users,
    packageId: t.packageId,
    packageName: t.package?.name ?? null,
    nextBillingDate: t.nextBillingDate?.toISOString() ?? null
  }));
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Prisma.PrismaClientKnownRequestError).code === "P2002"
  );
}

/** Provisions a new koperasi and its first admin login, on behalf of a platform admin. */
export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const data = createTenantSchema.parse(input);
  const passwordHash = await bcrypt.hash(data.adminPassword, BCRYPT_ROUNDS);

  const tenant = await db
    .$transaction(async (tx) => {
      const { tenant, roles } = await provisionTenantInTx(tx, {
        name: data.tenantName,
        slug: data.slug,
        registrationNo: data.registrationNo,
        address: data.address,
        type: data.type,
        cooperativeType: data.cooperativeType,
        firstUnit: data.firstUnit
      });

      const superAdminRole = roles.find((r) => r.name === "Super Admin");
      if (!superAdminRole) throw new Error("Super Admin role was not seeded");

      await tx.user.create({
        data: {
          tenantId: tenant.id,
          roleId: superAdminRole.id,
          email: data.adminEmail,
          name: data.adminName,
          passwordHash
        }
      });

      return tenant;
    })
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) {
        throw conflict("A cooperative with that slug, registration number, or admin email already exists");
      }
      throw err;
    });

  return toPublicTenant(tenant);
}

/** Platform admin toggling a tenant's active status and/or assigned subscription package. */
export async function updateTenantStatus(tenantId: string, data: UpdateTenantStatusInput): Promise<Tenant> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw notFound("Koperasi tidak ditemukan");

  if (data.packageId) {
    const pkg = await db.subscriptionPackage.findUnique({ where: { id: data.packageId } });
    if (!pkg) throw notFound("Paket langganan tidak ditemukan");
  }

  const updated = await db.tenant.update({
    where: { id: tenantId },
    data: {
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.packageId !== undefined ? { packageId: data.packageId } : {}),
      ...(data.nextBillingDate !== undefined ? { nextBillingDate: data.nextBillingDate } : {})
    }
  });
  return toPublicTenant(updated);
}

// ── Subscription Packages ─────────────────────────────────────────────────────

function toPublicPackage(pkg: DbPackage): SubscriptionPackage {
  return {
    id: pkg.id,
    name: pkg.name,
    price: pkg.price.toString(),
    modules: pkg.modules as SubscriptionPackage["modules"],
    maxUsers: pkg.maxUsers,
    maxMembers: pkg.maxMembers,
    maxSavingConfigs: pkg.maxSavingConfigs,
    whitelabelEnabled: pkg.whitelabelEnabled,
    isActive: pkg.isActive,
    createdAt: pkg.createdAt.toISOString()
  };
}

export async function listPackages(): Promise<SubscriptionPackage[]> {
  const packages = await db.subscriptionPackage.findMany({ orderBy: { createdAt: "asc" } });
  return packages.map(toPublicPackage);
}

export async function createPackage(data: CreatePackageInput): Promise<SubscriptionPackage> {
  const created = await db.subscriptionPackage.create({
    data: { ...data, maxSavingConfigs: data.maxSavingConfigs ?? null, isActive: true }
  });
  return toPublicPackage(created);
}

export async function updatePackage(id: string, data: UpdatePackageInput): Promise<SubscriptionPackage> {
  const pkg = await db.subscriptionPackage.findUnique({ where: { id } });
  if (!pkg) throw notFound("Paket langganan tidak ditemukan");

  const updated = await db.subscriptionPackage.update({ where: { id }, data });
  return toPublicPackage(updated);
}

export async function deactivatePackage(id: string): Promise<SubscriptionPackage> {
  const pkg = await db.subscriptionPackage.findUnique({ where: { id } });
  if (!pkg) throw notFound("Paket langganan tidak ditemukan");

  const updated = await db.subscriptionPackage.update({ where: { id }, data: { isActive: false } });
  return toPublicPackage(updated);
}

// ── Platform Admin Users ───────────────────────────────────────────────────────
//
// Platform admins are User rows with isPlatformAdmin=true. User requires a
// tenantId + roleId (tenant-scoped RBAC) that is meaningless here — access is
// gated purely on isPlatformAdmin (see middleware/rbac.ts#requirePlatformAdmin),
// never on role.permissions — so a new platform admin is attached to the
// creating admin's own tenantId/roleId purely to satisfy the FK constraint.
//
// These are the one legitimate class of cross-tenant User query, so they run
// through withoutTenantScope() to opt out of the tenant-scope guard in
// lib/tenant-scope.ts — every other call in this module keeps the guard on.

export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  const users = await withoutTenantScope(() =>
    db.user.findMany({
      where: { isPlatformAdmin: true },
      include: { role: true },
      orderBy: { createdAt: "desc" }
    })
  );
  return users.map(toPublicUser);
}

export async function createPlatformAdmin(
  creator: { tenantId: string; roleId: string },
  data: CreatePlatformAdminRequest
): Promise<PlatformAdmin> {
  const existing = await withoutTenantScope(() =>
    db.user.findFirst({ where: { email: data.email, isPlatformAdmin: true } })
  );
  if (existing) throw conflict(`Email ${data.email} sudah terdaftar sebagai platform admin`);

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const created = await db.user.create({
    data: {
      tenantId: creator.tenantId,
      roleId: creator.roleId,
      email: data.email,
      name: data.name,
      passwordHash,
      isPlatformAdmin: true
    },
    include: { role: true }
  });
  return toPublicUser(created);
}

export async function updatePlatformAdmin(id: string, data: UpdatePlatformAdminRequest): Promise<PlatformAdmin> {
  const user = await withoutTenantScope(() => db.user.findFirst({ where: { id, isPlatformAdmin: true } }));
  if (!user) throw notFound("Platform admin tidak ditemukan");

  if (data.email && data.email !== user.email) {
    const duplicate = await withoutTenantScope(() =>
      db.user.findFirst({ where: { email: data.email, isPlatformAdmin: true } })
    );
    if (duplicate) throw conflict(`Email ${data.email} sudah digunakan`);
  }

  const updated = await withoutTenantScope(() =>
    db.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
      },
      include: { role: true }
    })
  );
  return toPublicUser(updated);
}

export async function deactivatePlatformAdmin(id: string, requestingUserId: string): Promise<void> {
  const user = await withoutTenantScope(() => db.user.findFirst({ where: { id, isPlatformAdmin: true } }));
  if (!user) throw notFound("Platform admin tidak ditemukan");

  if (id === requestingUserId) {
    throw conflict("Anda tidak dapat menonaktifkan akun sendiri");
  }

  await withoutTenantScope(() => db.user.update({ where: { id }, data: { isActive: false } }));
}
