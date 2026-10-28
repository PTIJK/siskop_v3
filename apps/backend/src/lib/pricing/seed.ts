import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { db } from "../db.js";
import { writePricingAudit } from "./audit.js";
import { buildCatalogSnapshot } from "./snapshot.js";

const limit = z.number().int().min(0).nullable();
const limitsSchema = z.object({ members: limit, users: limit, savingTypes: limit, loanTypes: limit });

const seedSchema = z
  .object({
    version: z.number().int().min(1),
    settings: z.object({
      yearlyMultiplier: z.number().int().min(1),
      enabledCycles: z.array(z.enum(["MONTHLY", "YEARLY"])).min(1),
      defaultPackageCode: z.string().min(1),
      customEnabled: z.boolean(),
      customBaseLimits: limitsSchema,
      addonsOnFixedPackages: z.boolean(),
      paymentGraceDays: z.number().int().min(0),
      unpaidRegistrationPurgeDays: z.number().int().min(0),
      // Owner inputs: null until the owner enters them; never defaulted here.
      taxRate: z.number().min(0).max(1).nullable(),
      invoiceNumberFormat: z.string().min(1),
      paymentProvider: z.string().min(1),
      paymentInstructions: z.string().nullable(),
      oneFreeTenantPerRegistrationNo: z.boolean()
    }),
    packages: z
      .array(
        z.object({
          code: z.string().min(1),
          name: z.string().min(1),
          isCustom: z.boolean(),
          isPublic: z.boolean(),
          sortOrder: z.number().int(),
          priceMonthly: z.number().min(0).nullable(),
          priceYearly: z.number().min(0).nullable(),
          // Custom's limits are the string "dynamic: ..." (settings.customBaseLimits + add-ons).
          limits: z.union([limitsSchema, z.string()])
        })
      )
      .min(1),
    features: z.array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        parentKey: z.string().nullable(),
        requires: z.array(z.string()),
        customPrice: z.number().min(0),
        priceGroup: z.string().optional(),
        includedIn: z.array(z.string())
      })
    ),
    volumeAddons: z.array(
      z.object({
        itemKey: z.enum(["MEMBERS", "USERS", "SAVING_TYPES", "LOAN_TYPES"]),
        stepQty: z.number().int().min(1),
        price: z.number().min(0),
        period: z.enum(["MONTHLY", "YEARLY"])
      })
    ),
    supportPlans: z.array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        yearlyCost: z.number().min(0),
        remote: z.boolean(),
        onsite: z.boolean(),
        visitsPerYear: z.number().int().min(0),
        slaHours: z.number().int().min(0).nullable(),
        aiSupport: z.boolean()
      })
    )
  })
  .superRefine((seed, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const featureKeys = new Set<string>();
    for (const f of seed.features) {
      if (featureKeys.has(f.key)) issue(`Duplicate feature key "${f.key}"`);
      featureKeys.add(f.key);
    }
    const packageByCode = new Map(seed.packages.map((p) => [p.code, p]));
    for (const p of seed.packages) {
      if (!p.isCustom && p.priceMonthly !== null && p.priceYearly === null) {
        issue(`Package "${p.code}" has priceMonthly but no priceYearly`);
      }
    }
    for (const f of seed.features) {
      if (f.parentKey !== null && !featureKeys.has(f.parentKey)) issue(`Feature "${f.key}" has unknown parentKey "${f.parentKey}"`);
      for (const r of f.requires) if (!featureKeys.has(r)) issue(`Feature "${f.key}" requires unknown feature "${r}"`);
      for (const code of f.includedIn) {
        const pkg = packageByCode.get(code);
        if (!pkg) issue(`Feature "${f.key}" is includedIn unknown package "${code}"`);
        else if (pkg.isCustom) issue(`Feature "${f.key}" is includedIn the custom package "${code}", which is priced per feature`);
      }
    }
    if (!packageByCode.has(seed.settings.defaultPackageCode)) {
      issue(`defaultPackageCode "${seed.settings.defaultPackageCode}" is not a package`);
    }
  });

export type PricingSeed = z.infer<typeof seedSchema>;

/** Validates the seed file shape and every cross-reference before anything touches the database. */
export function parsePricingSeed(raw: unknown): PricingSeed {
  const result = seedSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid pricing seed: ${result.error.issues.map((i) => i.message).join("; ")}`);
  }
  return result.data;
}

const dec = (n: number | null): Prisma.Decimal | null => (n === null ? null : new Prisma.Decimal(n));
const NO_LIMITS = { members: null, users: null, savingTypes: null, loanTypes: null };

export interface LoadPricingSeedResult {
  /** True when the seed's version was already published, so nothing was written. */
  skipped: boolean;
  version: number;
}

/**
 * Loads the catalog and publishes it as PricingVersion `seed.version`.
 *
 * A version that already exists is never rewritten, and the live tables are
 * left alone then too: once the owner edits the draft, re-running the seed
 * must not silently revert those edits. Everything runs in one transaction.
 */
export async function loadPricingSeed(
  client: typeof db,
  seed: PricingSeed,
  opts: { actorId?: string | null } = {}
): Promise<LoadPricingSeedResult> {
  return client.$transaction(async (tx) => {
    if (await tx.pricingVersion.findUnique({ where: { version: seed.version } })) {
      return { skipped: true, version: seed.version };
    }

    const s = seed.settings;
    const settingData = {
      yearlyMultiplier: s.yearlyMultiplier,
      enabledCycles: s.enabledCycles,
      defaultPackageCode: s.defaultPackageCode,
      customEnabled: s.customEnabled,
      customBaseLimits: s.customBaseLimits,
      addonsOnFixedPackages: s.addonsOnFixedPackages,
      paymentGraceDays: s.paymentGraceDays,
      unpaidRegistrationPurgeDays: s.unpaidRegistrationPurgeDays,
      taxRate: dec(s.taxRate),
      invoiceNumberFormat: s.invoiceNumberFormat,
      paymentProvider: s.paymentProvider,
      paymentInstructions: s.paymentInstructions,
      oneFreeTenantPerRegistrationNo: s.oneFreeTenantPerRegistrationNo
    };
    await tx.pricingSetting.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...settingData }, update: settingData });

    const packageIds = new Map<string, string>();
    for (const p of seed.packages) {
      const limits = typeof p.limits === "string" ? NO_LIMITS : p.limits;
      const data = {
        name: p.name,
        isCustom: p.isCustom,
        isPublic: p.isPublic,
        sortOrder: p.sortOrder,
        priceMonthly: dec(p.priceMonthly),
        priceYearly: dec(p.priceYearly),
        // Legacy mirror so the not-yet-migrated code paths keep a number.
        price: new Prisma.Decimal(p.priceMonthly ?? 0),
        maxMembers: limits.members,
        maxUsers: limits.users,
        maxSavingTypes: limits.savingTypes,
        maxLoanTypes: limits.loanTypes
      };
      const row = await tx.subscriptionPackage.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: data });
      packageIds.set(p.code, row.id);
    }

    // Two passes: parents may appear after their children in the file.
    const featureIds = new Map<string, string>();
    for (const [index, f] of seed.features.entries()) {
      const data = {
        name: f.name,
        requires: f.requires,
        customPrice: new Prisma.Decimal(f.customPrice),
        priceGroup: f.priceGroup ?? null,
        sortOrder: index
      };
      const row = await tx.feature.upsert({ where: { key: f.key }, create: { key: f.key, ...data }, update: data });
      featureIds.set(f.key, row.id);
    }
    for (const f of seed.features) {
      await tx.feature.update({
        where: { key: f.key },
        data: { parentId: f.parentKey === null ? null : (featureIds.get(f.parentKey) ?? null) }
      });
    }

    await tx.packageFeature.deleteMany({ where: { packageId: { in: [...packageIds.values()] } } });
    await tx.packageFeature.createMany({
      data: seed.features.flatMap((f) =>
        f.includedIn.map((code) => ({ packageId: packageIds.get(code) as string, featureId: featureIds.get(f.key) as string }))
      )
    });

    for (const a of seed.volumeAddons) {
      const data = { stepQty: a.stepQty, price: new Prisma.Decimal(a.price), period: a.period };
      await tx.volumeAddon.upsert({ where: { itemKey: a.itemKey }, create: { itemKey: a.itemKey, ...data }, update: data });
    }
    for (const sp of seed.supportPlans) {
      const data = {
        name: sp.name,
        yearlyCost: new Prisma.Decimal(sp.yearlyCost),
        remote: sp.remote,
        onsite: sp.onsite,
        visitsPerYear: sp.visitsPerYear,
        slaHours: sp.slaHours,
        aiSupport: sp.aiSupport
      };
      await tx.supportPlan.upsert({ where: { code: sp.code }, create: { code: sp.code, ...data }, update: data });
    }

    const snapshot = await buildCatalogSnapshot(tx);
    await tx.pricingVersion.create({
      data: { version: seed.version, snapshot: snapshot as unknown as Prisma.InputJsonValue, publishedBy: opts.actorId ?? null }
    });
    await writePricingAudit(tx, {
      actorId: opts.actorId,
      entity: "PricingVersion",
      entityId: String(seed.version),
      action: "SEED_PUBLISH",
      after: { version: seed.version, packages: seed.packages.length, features: seed.features.length }
    });

    return { skipped: false, version: seed.version };
  });
}
