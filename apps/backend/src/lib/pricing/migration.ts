import type { db } from "../db.js";
import { withoutTenantScope } from "../tenant-scope.js";

/**
 * Dry-run planner for the one-off move from the legacy SubscriptionPackage
 * flags to TenantSubscription rows. It only reads. Applying the plan needs the
 * owner-approved mapping table and is deliberately not implemented here.
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
  const gated = new Set([...ACCOUNTING_FEATURES, ...WHITELABEL_FEATURES, ...PASAR_FEATURES, ...SUBDOMAIN_FEATURES]);

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

    const legacyKeys = new Set(allKeys.filter((k) => !gated.has(k)));
    if (legacy?.modules.includes("accounting")) ACCOUNTING_FEATURES.forEach((k) => legacyKeys.add(k));
    if (legacy?.modules.includes("pasar")) PASAR_FEATURES.forEach((k) => legacyKeys.add(k));
    if (legacy?.whitelabelEnabled) WHITELABEL_FEATURES.forEach((k) => legacyKeys.add(k));
    if (legacy?.customSubdomainEnabled) SUBDOMAIN_FEATURES.forEach((k) => legacyKeys.add(k));
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
