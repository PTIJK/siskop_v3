import { Prisma } from "@prisma/client";
import { db } from "../../lib/db.js";
import { conflict } from "../../lib/errors.js";

export interface DomainTenant {
  id: string; name: string; slug: string; isActive: boolean; slugLastChangedAt: Date | null;
  nextBillingDate: Date | null;
  package: { customSubdomainEnabled: boolean } | null;
}
export interface DomainActor {
  firebaseUid: string | null; isActive: boolean; canUpdate: boolean;
}
export interface DomainHistory { oldSlug: string; newSlug: string; createdAt: Date }
export interface DomainTransaction {
  tenant: DomainTenant | null;
  actor(userId: string): Promise<DomainActor | null>;
  save(slug: string, actorUserId: string, at: Date): Promise<void>;
}
export interface TenantDomainRepository {
  findTenant(tenantId: string): Promise<DomainTenant | null>;
  resolve(slug: string): Promise<DomainTenant | null>;
  history(tenantId: string): Promise<DomainHistory[]>;
  actor(tenantId: string, userId: string): Promise<DomainActor | null>;
  locked<T>(tenantId: string, work: (transaction: DomainTransaction) => Promise<T>): Promise<T>;
}

function canUpdate(permissions: unknown): boolean {
  const p = permissions as { config?: { update?: boolean } } | null;
  return p?.config?.update === true;
}
async function actor(tenantId: string, userId: string, client = db) {
  const user = await client.user.findFirst({ where: { id: userId, tenantId }, include: { role: true } });
  return user ? { firebaseUid: user.firebaseUid, isActive: user.isActive, canUpdate: canUpdate(user.role.permissions) } : null;
}

export const tenantDomainRepository: TenantDomainRepository = {
  findTenant: (id) => db.tenant.findUnique({ where: { id }, include: { package: true } }),
  async resolve(slug) {
    const reserved = await db.tenantSlugReservation.findUnique({ where: { slug }, include: { tenant: { include: { package: true } } } });
    // Supports records created by a previous API revision during an additive rollout.
    return reserved?.tenant ?? db.tenant.findUnique({ where: { slug }, include: { package: true } });
  },
  history: (tenantId) => db.tenantSlugChange.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 }),
  actor,
  async locked(tenantId, work) {
    try {
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, include: { package: true } });
        return work({
          tenant,
          async actor(userId) {
            const user = await tx.user.findFirst({ where: { id: userId, tenantId }, include: { role: true } });
            return user ? { firebaseUid: user.firebaseUid, isActive: user.isActive, canUpdate: canUpdate(user.role.permissions) } : null;
          },
          async save(slug, actorUserId, at) {
            if (!tenant) throw new Error("Missing locked tenant");
            const reservation = await tx.tenantSlugReservation.findUnique({ where: { slug } });
            if (reservation && reservation.tenantId !== tenantId) throw conflict("Alamat sudah digunakan atau dicadangkan.");
            // Preserve the current address even when an older deployment created it.
            await tx.tenantSlugReservation.createMany({ data: [{ slug: tenant.slug, tenantId }, { slug, tenantId }], skipDuplicates: true });
            const owner = await tx.tenantSlugReservation.findUnique({ where: { slug } });
            if (owner?.tenantId !== tenantId) throw conflict("Alamat sudah digunakan atau dicadangkan.");
            await tx.tenant.update({ where: { id: tenantId }, data: { slug, slugLastChangedAt: at } });
            await tx.tenantSlugChange.create({ data: { tenantId, oldSlug: tenant.slug, newSlug: slug, actorUserId, createdAt: at } });
          }
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Alamat sudah digunakan atau dicadangkan.");
      throw error;
    }
  }
};
