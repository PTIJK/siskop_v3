import type { BillingCycle, PricingLimits, TenantSubscriptionInfo, VolumeItem } from "@siskop/types";
import { db, type TxClient } from "../db.js";
import { featureNotEntitled, quotaExceeded } from "../errors.js";
import { resolveEntitlements, type Entitlements, type SubscriptionSnapshot } from "./engine.js";
import { enforcementMode } from "./flags.js";

export interface TenantEntitlements extends Entitlements {
  packageName: string;
  status: TenantSubscriptionInfo["status"];
  billingCycle: BillingCycle;
  nextBillingDate: string | null;
}

type Client = Pick<TxClient, "tenantSubscription">;

async function loadEntitlements(client: Client, tenantId: string): Promise<TenantEntitlements | null> {
  const sub = await client.tenantSubscription.findUnique({ where: { tenantId } });
  if (!sub) return null;
  const snapshot = sub.snapshot as unknown as SubscriptionSnapshot;
  const base = resolveEntitlements({ snapshot, limitOverrides: sub.limitOverrides as Partial<PricingLimits> | null });
  const cancelled = sub.status === "CANCELLED";
  return {
    ...base,
    features: cancelled ? [] : base.features,
    hasFeature: (key) => !cancelled && base.hasFeature(key),
    packageName: snapshot.packageName,
    status: sub.status,
    billingCycle: sub.billingCycle,
    nextBillingDate: sub.nextBillingDate?.toISOString() ?? null
  };
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: TenantEntitlements }>();

/**
 * Entitlements are not in the JWT: they are read here, per tenant, and cached
 * for 60 seconds. Whatever changes a subscription must call clearEntitlementCache.
 * A tenant with no subscription returns null and is never cached.
 */
export async function getTenantEntitlements(tenantId: string, now: number = Date.now()): Promise<TenantEntitlements | null> {
  const hit = cache.get(tenantId);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = await loadEntitlements(db, tenantId);
  if (value) cache.set(tenantId, { at: now, value });
  else cache.delete(tenantId);
  return value;
}

export function clearEntitlementCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * Whether a tenant may use `key`, for places that have no staff token to read
 * the tenant from: a public page resolved by slug, a member or collector login.
 * Follows PRICING_V2_ENFORCEMENT: off and shadow always say yes (shadow logs a miss).
 */
export async function tenantHasFeature(tenantId: string, key: string): Promise<boolean> {
  const mode = enforcementMode();
  if (mode === "off") return true;
  if ((await getTenantEntitlements(tenantId))?.hasFeature(key)) return true;
  if (mode === "shadow") {
    console.warn(`PRICING_SHADOW FEATURE_NOT_ENTITLED tenant=${tenantId} feature=${key}`);
    return true;
  }
  return false;
}

export async function assertTenantFeature(tenantId: string, key: string): Promise<void> {
  if (!(await tenantHasFeature(tenantId, key))) {
    throw featureNotEntitled("Paket langganan Anda tidak mencakup fitur ini", { feature: key });
  }
}

export type Usage ={ members: number; users: number; savingTypes: number; loanTypes: number };

async function countUsage(tx: TxClient, tenantId: string): Promise<Usage> {
  const [members, users, savingTypes, loanTypes] = await Promise.all([
    tx.member.count({ where: { tenantId, isActive: true } }),
    tx.user.count({ where: { tenantId, isActive: true, isPlatformAdmin: false } }),
    tx.savingConfig.count({ where: { tenantId, isActive: true } }),
    tx.loanConfig.count({ where: { tenantId, isActive: true } })
  ]);
  return { members, users, savingTypes, loanTypes };
}

export async function getUsage(tenantId: string): Promise<Usage> {
  return db.$transaction((tx) => countUsage(tx, tenantId));
}

const DIM: Record<VolumeItem, keyof PricingLimits> = { MEMBERS: "members", USERS: "users", SAVING_TYPES: "savingTypes", LOAN_TYPES: "loanTypes" };

/**
 * Checks (and in `on` mode enforces) the volume limit for `adding` more rows of
 * `item`, inside the caller's transaction. With `lock` (the default) the
 * subscription row is locked first, so two concurrent creates serialise and
 * cannot both take the last slot; the lock lasts until the caller's
 * transaction ends, so the insert must happen in that same transaction.
 * Over-limit tenants are blocked from creating more, never trimmed.
 */
export async function assertQuota(
  tx: TxClient,
  tenantId: string,
  item: VolumeItem,
  opts: { adding?: number; lock?: boolean } = {}
): Promise<void> {
  const mode = enforcementMode();
  if (mode === "off") return;
  if (opts.lock ?? true) await tx.$queryRaw`SELECT "id" FROM "TenantSubscription" WHERE "tenantId" = ${tenantId} FOR UPDATE`;
  const ent = await loadEntitlements(tx, tenantId);

  if (!ent) {
    if (mode === "on") throw featureNotEntitled("Langganan tidak ditemukan", { item });
    console.warn(`PRICING_SHADOW FEATURE_NOT_ENTITLED tenant=${tenantId} quota=${item} (no subscription)`);
    return;
  }

  const limit = ent.limits[DIM[item]];
  if (limit === null) return;
  const used = (await countUsage(tx, tenantId))[DIM[item]];
  if (used + (opts.adding ?? 1) <= limit) return;
  if (mode === "on") throw quotaExceeded(item, limit, used);
  console.warn(`PRICING_SHADOW QUOTA_EXCEEDED tenant=${tenantId} item=${item} limit=${limit} used=${used}`);
}

/**
 * Runs `work` (the insert) in the same transaction that checks the limit.
 * `adding` is how many rows the work inserts (an import passes its row count).
 */
export async function withQuota<T>(
  tenantId: string,
  item: VolumeItem,
  work: (tx: TxClient) => Promise<T>,
  opts: { adding?: number } = {}
): Promise<T> {
  if (enforcementMode() === "off") return db.$transaction(work);
  return db.$transaction(async (tx) => {
    await assertQuota(tx, tenantId, item, opts);
    return work(tx);
  });
}

/**
 * An early, lock-free check for flows that do something irreversible before
 * their insert (creating an external login account): refuse before that step
 * instead of after. The locked assertQuota inside the insert stays the real guard.
 */
export async function precheckQuota(tenantId: string, item: VolumeItem, opts: { adding?: number } = {}): Promise<void> {
  if (enforcementMode() === "off") return;
  await db.$transaction((tx) => assertQuota(tx, tenantId, item, { ...opts, lock: false }));
}
