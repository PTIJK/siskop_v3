import type { db } from "../db.js";
import { withoutTenantScope } from "../tenant-scope.js";
import { writePricingAudit } from "./audit.js";
import { getPublishedCatalog } from "./catalog.js";
import { buildSubscriptionSnapshot } from "./engine.js";
import { clearEntitlementCache } from "./entitlements.js";

/**
 * Dry-run planner for the one-off move from the legacy SubscriptionPackage
 * flags to TenantSubscription rows. It only reads. Applying the plan needs the
 * owner-approved mapping table: see applySubscriptionMigration below.
 */

export interface MigrationUsage {
  members: number;
  users: number;
  savingTypes: number;
  loanTypes: number;
}

export interface MigrationPlanRow {
  tenantId: string;
  tenantName: string;
  legacyPackageId: string | null;
  legacyPackageName: string | null;
  targetPackageCode: string;
  billingCycle: "MONTHLY";
  /** The tenant's current legacy price, kept as-is. Decimal string. */
  amountPerCycle: string;
  nextBillingDate: string | null;
  createdVia: "MIGRATION";
  usage: MigrationUsage;
  /** Only the dimensions where current usage exceeds the target limit. Value = current usage. */
  limitOverrides: Partial<MigrationUsage>;
  featuresLost: string[];
  featuresGained: string[];
}

export interface MigrationPlan {
  rows: MigrationPlanRow[];
  unmapped: { tenantId: string; tenantName: string; legacyPackageId: string | null; legacyPackageName: string | null }[];
  alreadyMigrated: number;
}

/**
 * What the legacy flags actually gated. Everything not listed here was open to
 * every tenant, whatever its package. `pasar` is read from `modules` too, even
 * though the admin form can no longer set it.
 */
const ACCOUNTING_FEATURES = [
  "accounting_book",
  "manual_journal",
  "period_closing",
  "reports_regulatory",
  "reports_consolidated",
  "coa_standard_template",
  "auto_mapping",
  "config_coa",
  "config_account_mapping",
  "config_shu"
];
const WHITELABEL_FEATURES = ["whitelabel"];
const PASAR_FEATURES = ["unit_pasar", "reports_market"];
const SUBDOMAIN_FEATURES = ["workspace_address"];
/** No legacy feature sits behind these, so comparing access for them would be noise. */
const NOT_BUILT_YET = new Set(["ai_chatbot", "ocr"]);

type Client = typeof db;
const NONE_KEY = "none";

type LegacyPackage = { modules: string[]; whitelabelEnabled: boolean; customSubdomainEnabled: boolean } | null;

/** The Pricing V2 features a tenant could reach under its legacy package: everything ungated, plus what its flags unlocked. */
function legacyFeatureKeys(legacy: LegacyPackage, allKeys: string[]): Set<string> {
  const gated = new Set([...ACCOUNTING_FEATURES, ...WHITELABEL_FEATURES, ...PASAR_FEATURES, ...SUBDOMAIN_FEATURES]);
  const keys = new Set(allKeys.filter((k) => !gated.has(k)));
  if (legacy?.modules.includes("accounting")) ACCOUNTING_FEATURES.forEach((k) => keys.add(k));
  if (legacy?.modules.includes("pasar")) PASAR_FEATURES.forEach((k) => keys.add(k));
  if (legacy?.whitelabelEnabled) WHITELABEL_FEATURES.forEach((k) => keys.add(k));
  if (legacy?.customSubdomainEnabled) SUBDOMAIN_FEATURES.forEach((k) => keys.add(k));
  return keys;
}

export async function planSubscriptionMigration(client: Client, opts: { mapping: Record<string, string> }): Promise<MigrationPlan> {
  const targets = await client.subscriptionPackage.findMany({
    where: { code: { not: null } },
    include: { features: { where: { included: true }, include: { feature: true } } }
  });
  const byCode = new Map(targets.map((p) => [p.code as string, p]));
  for (const code of new Set(Object.values(opts.mapping))) {
    if (!byCode.has(code)) throw new Error(`Mapping targets unknown package code "${code}"`);
  }

  const allKeys = (await client.feature.findMany({ select: { key: true } })).map((f) => f.key).filter((k) => !NOT_BUILT_YET.has(k));

  const tenants = await client.tenant.findMany({ include: { package: true }, orderBy: { createdAt: "asc" } });

  // Platform-wide read for a one-off script: counts every tenant at once.
  const [members, users, savingTypes, loanTypes, subscribed] = await withoutTenantScope(async () =>
    Promise.all([
      client.member.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenants.map((t) => t.id) }, isActive: true }, _count: { _all: true } }),
      client.user.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenants.map((t) => t.id) }, isActive: true, isPlatformAdmin: false }, _count: { _all: true } }),
      client.savingConfig.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenants.map((t) => t.id) }, isActive: true }, _count: { _all: true } }),
      client.loanConfig.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenants.map((t) => t.id) }, isActive: true }, _count: { _all: true } }),
      client.tenantSubscription.findMany({ select: { tenantId: true } })
    ])
  );
  const countOf = (rows: { tenantId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.tenantId, r._count._all]));
  const memberCount = countOf(members);
  const userCount = countOf(users);
  const savingCount = countOf(savingTypes);
  const loanCount = countOf(loanTypes);
  const subscribedIds = new Set(subscribed.map((s) => s.tenantId));

  const plan: MigrationPlan = { rows: [], unmapped: [], alreadyMigrated: 0 };

  for (const t of tenants) {
    if (subscribedIds.has(t.id)) {
      plan.alreadyMigrated += 1;
      continue;
    }
    const legacy = t.package;
    const targetCode = opts.mapping[legacy?.id ?? NONE_KEY];
    if (!targetCode) {
      plan.unmapped.push({ tenantId: t.id, tenantName: t.name, legacyPackageId: legacy?.id ?? null, legacyPackageName: legacy?.name ?? null });
      continue;
    }
    const target = byCode.get(targetCode)!;

    const usage: MigrationUsage = {
      members: memberCount.get(t.id) ?? 0,
      users: userCount.get(t.id) ?? 0,
      savingTypes: savingCount.get(t.id) ?? 0,
      loanTypes: loanCount.get(t.id) ?? 0
    };
    const limits: Record<keyof MigrationUsage, number | null> = {
      members: target.maxMembers,
      users: target.maxUsers,
      savingTypes: target.maxSavingTypes,
      loanTypes: target.maxLoanTypes
    };
    const limitOverrides: Partial<MigrationUsage> = {};
    for (const dim of Object.keys(usage) as (keyof MigrationUsage)[]) {
      const cap = limits[dim];
      if (cap !== null && usage[dim] > cap) limitOverrides[dim] = usage[dim];
    }

    const legacyKeys = legacyFeatureKeys(legacy, allKeys);
    const newKeys = new Set(target.features.map((pf) => pf.feature.key).filter((k) => !NOT_BUILT_YET.has(k)));

    plan.rows.push({
      tenantId: t.id,
      tenantName: t.name,
      legacyPackageId: legacy?.id ?? null,
      legacyPackageName: legacy?.name ?? null,
      targetPackageCode: targetCode,
      billingCycle: "MONTHLY",
      amountPerCycle: legacy ? legacy.price.toString() : "0",
      nextBillingDate: t.nextBillingDate?.toISOString() ?? null,
      createdVia: "MIGRATION",
      usage,
      limitOverrides,
      featuresLost: allKeys.filter((k) => legacyKeys.has(k) && !newKeys.has(k)),
      featuresGained: allKeys.filter((k) => !legacyKeys.has(k) && newKeys.has(k))
    });
  }

  return plan;
}

export interface MigrationApplyOptions {
  /** Legacy package id (or "none") to the approved Pricing V2 package code. The owner supplies it. */
  mapping: Record<string, string>;
  /** Migrate a tenant even when the new package gives it less than it has today. Off by default. */
  allowFeatureLoss?: boolean;
  now?: Date;
}

export interface MigrationApplyResult {
  created: number;
  alreadyMigrated: number;
  unmapped: MigrationPlan["unmapped"];
  /** Not migrated: the new package would remove features the tenant has now. */
  blockedByFeatureLoss: { tenantId: string; tenantName: string; targetPackageCode: string; featuresLost: string[] }[];
  /** Not migrated: the koperasi is switched off, so there is no live access to preserve. */
  skippedInactive: { tenantId: string; tenantName: string }[];
  failed: { tenantId: string; tenantName: string; reason: string }[];
}

/**
 * The one-off move to TenantSubscription. It only creates subscriptions, one
 * transaction per tenant, so a failure affects that tenant alone and the run
 * can be repeated: migrated tenants are skipped. Each tenant keeps its current
 * price and billing date. Limits and features come from the PUBLISHED catalog
 * (what the tenant will actually get), and a limit override is added wherever
 * current usage is above it, so nothing is trimmed. The legacy package link on
 * Tenant is left untouched. Never guesses: no mapping, no change.
 */
export async function applySubscriptionMigration(client: Client, opts: MigrationApplyOptions): Promise<MigrationApplyResult> {
  const published = await getPublishedCatalog();
  const catalog = published.snapshot;
  for (const code of new Set(Object.values(opts.mapping))) {
    if (!catalog.packages.some((p) => p.code === code)) throw new Error(`Mapping targets unknown package code "${code}"`);
  }

  const plan = await planSubscriptionMigration(client, { mapping: opts.mapping });
  const result: MigrationApplyResult = {
    created: 0,
    alreadyMigrated: plan.alreadyMigrated,
    unmapped: plan.unmapped,
    blockedByFeatureLoss: [],
    skippedInactive: [],
    failed: []
  };

  const allKeys = catalog.features.map((f) => f.key).filter((k) => !NOT_BUILT_YET.has(k));
  const tenants = await client.tenant.findMany({
    where: { id: { in: plan.rows.map((r) => r.tenantId) } },
    include: { package: true }
  });
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  for (const row of plan.rows) {
    const tenant = tenantById.get(row.tenantId);
    if (!tenant) continue;
    if (!tenant.isActive) {
      result.skippedInactive.push({ tenantId: tenant.id, tenantName: tenant.name });
      continue;
    }
    try {
      const target = catalog.packages.find((p) => p.code === row.targetPackageCode)!;
      const targetKeys = new Set(target.features.filter((k) => !NOT_BUILT_YET.has(k)));
      const lost = allKeys.filter((k) => legacyFeatureKeys(tenant.package, allKeys).has(k) && !targetKeys.has(k));
      if (lost.length > 0 && !opts.allowFeatureLoss) {
        result.blockedByFeatureLoss.push({ tenantId: tenant.id, tenantName: tenant.name, targetPackageCode: target.code, featuresLost: lost });
        continue;
      }

      const limitOverrides: Partial<MigrationUsage> = {};
      for (const dim of Object.keys(row.usage) as (keyof MigrationUsage)[]) {
        const cap = target.limits[dim];
        if (cap !== null && row.usage[dim] > cap) limitOverrides[dim] = row.usage[dim];
      }

      const snapshot = buildSubscriptionSnapshot({ packageCode: target.code, billingCycle: "MONTHLY" }, published);
      const pkg = await client.subscriptionPackage.findUniqueOrThrow({ where: { code: target.code } });
      await client.$transaction(async (tx) => {
        await tx.tenantSubscription.create({
          data: {
            tenantId: tenant.id,
            packageId: pkg.id,
            pricingVersion: published.version,
            billingCycle: "MONTHLY",
            snapshot: snapshot as never,
            amountPerCycle: row.amountPerCycle,
            status: "ACTIVE",
            startsAt: opts.now ?? new Date(),
            nextBillingDate: tenant.nextBillingDate,
            createdVia: "MIGRATION",
            ...(Object.keys(limitOverrides).length > 0 ? { limitOverrides } : {})
          }
        });
        await writePricingAudit(tx, {
          entity: "subscription",
          entityId: tenant.id,
          action: "MIGRATED",
          before: { legacyPackage: tenant.package?.name ?? null, price: row.amountPerCycle },
          after: { package: target.code, amountPerCycle: row.amountPerCycle, limitOverrides, nextBillingDate: row.nextBillingDate }
        });
      });
      clearEntitlementCache(tenant.id);
      result.created += 1;
    } catch (error) {
      result.failed.push({ tenantId: tenant.id, tenantName: tenant.name, reason: error instanceof Error ? error.message : "unknown" });
    }
  }
  return result;
}
