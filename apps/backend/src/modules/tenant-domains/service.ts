import type { TenantDomainSettings, WorkspaceContext } from "@siskop/types";
import { conflict, forbidden, notFound, featureNotEntitled, unauthorized } from "../../lib/errors.js";
import { verifyFirebaseIdentity } from "../onboarding/firebase.js";
import { tenantBaseDomain, tenantDomainsEnabled, tenantLoginUrl } from "./config.js";
import { nextRenameAt, parseSlug, renameEligibility } from "./policy.js";
import { tenantDomainRepository, type DomainTenant, type TenantDomainRepository } from "./repository.js";

type IdentityVerifier = (token: string) => Promise<{ uid: string }>;
type Caller = { tenantId: string; userId: string };
function entitled(tenant: DomainTenant, now: Date): boolean {
  return tenant.package?.customSubdomainEnabled === true && (!tenant.nextBillingDate || tenant.nextBillingDate > now);
}
/** Business rules depend on ports; Firebase and Prisma are adapters at the composition boundary. */
export class TenantDomainService {
  constructor(
    private readonly repository: TenantDomainRepository,
    private readonly verifyIdentity: IdentityVerifier,
    private readonly clock = () => new Date()
  ) {}
  async resolve(slug: string): Promise<WorkspaceContext> {
    const tenant = await this.repository.resolve(slug);
    if (!tenant?.isActive) throw notFound("Workspace tidak ditemukan atau belum aktif.");
    return { tenantId: tenant.id, name: tenant.name, slug: tenant.slug, isAlias: slug !== tenant.slug, canonicalLoginUrl: tenantLoginUrl(tenant.slug) };
  }
  async settings(caller: Caller): Promise<TenantDomainSettings> {
    const [tenant, actor, history] = await Promise.all([
      this.repository.findTenant(caller.tenantId), this.repository.actor(caller.tenantId, caller.userId), this.repository.history(caller.tenantId)
    ]);
    if (!tenant || !actor?.isActive) throw unauthorized();
    const enabled = tenantDomainsEnabled() && process.env.TENANT_DOMAIN_RENAME_ENABLED === "true";
    const hasEntitlement = entitled(tenant, this.clock());
    const blockedReason = actor.canUpdate
      ? renameEligibility({ enabled, entitled: hasEntitlement, active: tenant.isActive, lastChangedAt: tenant.slugLastChangedAt }, this.clock())
      : "permission";
    return { slug: tenant.slug, loginUrl: tenantLoginUrl(tenant.slug), baseDomain: tenantBaseDomain(), enabled,
      entitled: hasEntitlement, canRename: blockedReason === null, blockedReason, nextChangeAt: nextRenameAt(tenant.slugLastChangedAt)?.toISOString() ?? null,
      history: history.map((h) => ({ oldSlug: h.oldSlug, newSlug: h.newSlug, changedAt: h.createdAt.toISOString() })) };
  }
  async rename(caller: Caller, input: { slug: string; idToken: string }): Promise<TenantDomainSettings> {
    const slug = parseSlug(input.slug);
    // Network verification happens before acquiring the database lock.
    const identity = await this.verifyIdentity(input.idToken);
    await this.repository.locked(caller.tenantId, async (transaction) => {
      const { tenant } = transaction;
      const actor = await transaction.actor(caller.userId);
      if (!tenant || !actor?.isActive || !actor.firebaseUid || actor.firebaseUid !== identity.uid) throw unauthorized();
      if (!actor.canUpdate) throw forbidden("Hanya admin koperasi yang dapat mengubah alamat.");
      const now = this.clock();
      const blocked = renameEligibility({ enabled: tenantDomainsEnabled() && process.env.TENANT_DOMAIN_RENAME_ENABLED === "true",
        entitled: entitled(tenant, now), active: tenant.isActive, lastChangedAt: tenant.slugLastChangedAt }, now);
      // Re-saving the same address never consumes the allowance, even during cooldown.
      if (slug === tenant.slug && (!blocked || blocked === "cooldown")) return;
      if (blocked === "package") throw featureNotEntitled("Paket aktif belum mendukung perubahan subdomain.");
      if (blocked === "cooldown") throw conflict(`Alamat dapat diubah kembali pada ${nextRenameAt(tenant.slugLastChangedAt)!.toISOString()}.`);
      if (blocked) throw forbidden("Perubahan alamat belum tersedia.");
      await transaction.save(slug, caller.userId, now);
    });
    return this.settings(caller);
  }
}
export const tenantDomains = new TenantDomainService(tenantDomainRepository, verifyFirebaseIdentity);
