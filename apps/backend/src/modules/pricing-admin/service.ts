import { Prisma } from "@prisma/client";
import { addMonths } from "date-fns";
import type { PricingLimits, PricingQuote, TenantSubscriptionInfo } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { writePricingAudit } from "../../lib/pricing/audit.js";
import { clearCatalogCache, getPublishedCatalog } from "../../lib/pricing/catalog.js";
import { diffCatalogs, type CatalogChange } from "../../lib/pricing/diff.js";
import { buildSubscriptionSnapshot, quote, resolveEntitlements, type PublishedCatalog, type SubscriptionSnapshot } from "../../lib/pricing/engine.js";
import { clearEntitlementCache, getUsage } from "../../lib/pricing/entitlements.js";
import { applySeedToDraft, parsePricingSeed, type PricingSeed } from "../../lib/pricing/seed.js";
import { buildCatalogSnapshot, type CatalogSnapshot } from "../../lib/pricing/snapshot.js";
import { snapshotToSeed } from "../../lib/pricing/transform.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import type { z } from "zod";
import type {
  addonsSchema,
  supportPlansSchema,
  tenantSubscriptionSchema,
  updatePackageSchema,
  updateSettingsSchema,
  upsertFeatureSchema
} from "./schema.js";

type Input<T extends z.ZodTypeAny> = z.output<T>;
type Json = Prisma.InputJsonValue;

const asJson = (v: unknown): Json => v as Json;
const str = (d: Prisma.Decimal | null): string | null => (d === null ? null : d.toString());

/** Parses a seed-shaped catalog, turning a malformed one into the owner's 422 rather than a 500. */
function parseSeed(raw: unknown): PricingSeed {
  try {
    return parsePricingSeed(raw);
  } catch (err) {
    throw validationError(err instanceof Error ? err.message : "Invalid pricing catalog");
  }
}

async function latestPublished(tx: TxClient) {
  return tx.pricingVersion.findFirst({ orderBy: { version: "desc" } });
}

// ── Draft ─────────────────────────────────────────────────────────────────────

export async function getDraft() {
  return db.$transaction(async (tx) => {
    const [catalog, published] = await Promise.all([buildCatalogSnapshot(tx), latestPublished(tx)]);
    const changes = published ? diffCatalogs(published.snapshot as unknown as CatalogSnapshot, catalog) : [];
    return { publishedVersion: published?.version ?? null, changeCount: changes.length, catalog };
  });
}

export async function getDiff(): Promise<{ fromVersion: number | null; changes: CatalogChange[] }> {
  return db.$transaction(async (tx) => {
    const [catalog, published] = await Promise.all([buildCatalogSnapshot(tx), latestPublished(tx)]);
    return {
      fromVersion: published?.version ?? null,
      changes: published ? diffCatalogs(published.snapshot as unknown as CatalogSnapshot, catalog) : []
    };
  });
}

// ── Packages ──────────────────────────────────────────────────────────────────

type PackageRow = Prisma.SubscriptionPackageGetPayload<object>;

function packageView(p: PackageRow) {
  return {
    name: p.name,
    isPublic: p.isPublic,
    sortOrder: p.sortOrder,
    priceMonthly: str(p.priceMonthly),
    priceYearly: str(p.priceYearly),
    limits: { members: p.maxMembers, users: p.maxUsers, savingTypes: p.maxSavingTypes, loanTypes: p.maxLoanTypes }
  };
}

export async function updatePackage(actorId: string, code: string, input: Input<typeof updatePackageSchema>) {
  return db.$transaction(async (tx) => {
    const pkg = await tx.subscriptionPackage.findUnique({ where: { code } });
    if (!pkg) throw notFound(`Paket "${code}" tidak ditemukan`);

    if (pkg.isCustom && (input.priceMonthly !== undefined || input.priceYearly !== undefined || input.limits !== undefined)) {
      throw validationError("Custom has no base price; its limits are settings.customBaseLimits plus add-ons");
    }
    const priceMonthly = input.priceMonthly !== undefined ? input.priceMonthly : pkg.priceMonthly;
    const priceYearly = input.priceYearly !== undefined ? input.priceYearly : pkg.priceYearly;
    if (!pkg.isCustom && priceMonthly !== null && priceYearly === null) {
      throw validationError("A package with a priceMonthly needs a priceYearly");
    }

    const updated = await tx.subscriptionPackage.update({
      where: { code },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        priceMonthly,
        priceYearly,
        // Legacy mirror so the not-yet-migrated code paths keep a number.
        price: priceMonthly ?? new Prisma.Decimal(0),
        ...(input.limits
          ? { maxMembers: input.limits.members, maxUsers: input.limits.users, maxSavingTypes: input.limits.savingTypes, maxLoanTypes: input.limits.loanTypes }
          : {})
      }
    });
    await writePricingAudit(tx, {
      actorId,
      entity: "SubscriptionPackage",
      entityId: code,
      action: "UPDATE",
      before: asJson(packageView(pkg)),
      after: asJson(packageView(updated))
    });
    return { code, ...packageView(updated) };
  });
}

// ── Features ──────────────────────────────────────────────────────────────────

type FeatureRow = Prisma.FeatureGetPayload<{ include: { parent: true } }>;

function featureView(f: FeatureRow) {
  return {
    name: f.name,
    parentKey: f.parent?.key ?? null,
    requires: f.requires,
    customPrice: f.customPrice.toString(),
    priceGroup: f.priceGroup,
    sortOrder: f.sortOrder,
    isActive: f.isActive
  };
}

/** True when following `requires` from `start` leads back to it, which would make the feature unselectable. */
function requiresCycle(start: string, requires: Map<string, string[]>): boolean {
  const seen = new Set<string>();
  const stack = [...(requires.get(start) ?? [])];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (key === start) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...(requires.get(key) ?? []));
  }
  return false;
}

export async function upsertFeature(actorId: string, key: string, input: Input<typeof upsertFeatureSchema>) {
  return db.$transaction(async (tx) => {
    const existing = await tx.feature.findUnique({ where: { key }, include: { parent: true } });
    if (!existing && !input.name) throw validationError("name is required to create a feature");

    const all = await tx.feature.findMany({ include: { parent: true } });
    const keys = new Set(all.map((f) => f.key));
    const requires = input.requires ?? existing?.requires ?? [];
    for (const r of requires) {
      if (r === key) throw validationError(`Feature "${key}" cannot require itself`);
      if (!keys.has(r)) throw validationError(`Feature "${key}" requires unknown feature "${r}"`);
    }
    let parentId = existing?.parentId ?? null;
    if (input.parentKey !== undefined) {
      if (input.parentKey === null) parentId = null;
      else {
        if (input.parentKey === key) throw validationError(`Feature "${key}" cannot be its own parent`);
        const parent = all.find((f) => f.key === input.parentKey);
        if (!parent) throw validationError(`Feature "${key}" has unknown parent "${input.parentKey}"`);
        parentId = parent.id;
      }
    }
    const graph = new Map(all.map((f) => [f.key, f.requires]));
    graph.set(key, requires);
    if (requiresCycle(key, graph)) throw validationError(`Feature "${key}" would create a requires cycle`);

    const sortOrder = input.sortOrder ?? existing?.sortOrder ?? Math.max(-1, ...all.map((f) => f.sortOrder)) + 1;
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      requires,
      parentId,
      sortOrder,
      ...(input.customPrice !== undefined ? { customPrice: input.customPrice } : {}),
      ...(input.priceGroup !== undefined ? { priceGroup: input.priceGroup } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
    };
    const saved = existing
      ? await tx.feature.update({ where: { key }, data, include: { parent: true } })
      : await tx.feature.create({ data: { key, name: input.name as string, ...data }, include: { parent: true } });

    await writePricingAudit(tx, {
      actorId,
      entity: "Feature",
      entityId: key,
      action: existing ? "UPDATE" : "CREATE",
      before: existing ? asJson(featureView(existing)) : null,
      after: asJson(featureView(saved))
    });
    return { key, ...featureView(saved) };
  });
}

/** Replaces which features each named fixed package includes. Packages not named are untouched. */
export async function setMatrix(actorId: string, matrix: Record<string, string[]>) {
  return db.$transaction(async (tx) => {
    const features = await tx.feature.findMany({ select: { id: true, key: true } });
    const idOf = new Map(features.map((f) => [f.key, f.id]));
    const before: Record<string, string[]> = {};
    const after: Record<string, string[]> = {};

    for (const [code, keys] of Object.entries(matrix)) {
      const pkg = await tx.subscriptionPackage.findUnique({ where: { code }, include: { features: { include: { feature: true } } } });
      if (!pkg) throw notFound(`Paket "${code}" tidak ditemukan`);
      if (pkg.isCustom) throw validationError("Custom is priced per feature; it has no feature matrix");
      const unique = [...new Set(keys)];
      for (const k of unique) if (!idOf.has(k)) throw validationError(`Unknown feature "${k}"`);

      before[code] = pkg.features.map((pf) => pf.feature.key);
      after[code] = unique;
      await tx.packageFeature.deleteMany({ where: { packageId: pkg.id } });
      await tx.packageFeature.createMany({ data: unique.map((k) => ({ packageId: pkg.id, featureId: idOf.get(k) as string })) });
    }
    await writePricingAudit(tx, { actorId, entity: "PackageFeature", action: "UPDATE", before: asJson(before), after: asJson(after) });
    return { updated: Object.keys(matrix) };
  });
}

// ── Add-ons, support plans, settings ──────────────────────────────────────────

export async function setAddons(actorId: string, rows: Input<typeof addonsSchema>) {
  return db.$transaction(async (tx) => {
    const before = (await tx.volumeAddon.findMany()).map((a) => ({ itemKey: a.itemKey, stepQty: a.stepQty, price: a.price.toString(), period: a.period }));
    for (const a of rows) {
      const data = { stepQty: a.stepQty, price: a.price, period: a.period };
      await tx.volumeAddon.upsert({ where: { itemKey: a.itemKey }, create: { itemKey: a.itemKey, ...data }, update: data });
    }
    const after = (await tx.volumeAddon.findMany()).map((a) => ({ itemKey: a.itemKey, stepQty: a.stepQty, price: a.price.toString(), period: a.period }));
    await writePricingAudit(tx, { actorId, entity: "VolumeAddon", action: "UPDATE", before: asJson(before), after: asJson(after) });
    return after;
  });
}

export async function setSupportPlans(actorId: string, rows: Input<typeof supportPlansSchema>) {
  return db.$transaction(async (tx) => {
    const view = (p: Prisma.SupportPlanGetPayload<object>) => ({ ...p, id: undefined, yearlyCost: p.yearlyCost.toString() });
    const before = (await tx.supportPlan.findMany({ orderBy: { code: "asc" } })).map(view);
    for (const p of rows) {
      const { code, ...data } = p;
      await tx.supportPlan.upsert({ where: { code }, create: { code, ...data }, update: data });
    }
    const after = (await tx.supportPlan.findMany({ orderBy: { code: "asc" } })).map(view);
    await writePricingAudit(tx, { actorId, entity: "SupportPlan", action: "UPDATE", before: asJson(before), after: asJson(after) });
    return after;
  });
}

export async function updateSettings(actorId: string, input: Input<typeof updateSettingsSchema>) {
  return db.$transaction(async (tx) => {
    if (input.defaultPackageCode !== undefined) {
      const pkg = await tx.subscriptionPackage.findUnique({ where: { code: input.defaultPackageCode } });
      if (!pkg) throw validationError(`defaultPackageCode "${input.defaultPackageCode}" is not a package`);
    }
    const before = (await buildCatalogSnapshot(tx)).settings;
    await tx.pricingSetting.update({ where: { id: "singleton" }, data: input });
    const after = (await buildCatalogSnapshot(tx)).settings;
    await writePricingAudit(tx, { actorId, entity: "PricingSetting", entityId: "singleton", action: "UPDATE", before: asJson(before), after: asJson(after) });
    return after;
  });
}

// ── Simulator ─────────────────────────────────────────────────────────────────

export async function simulateQuote(input: { source: "draft" | "published" } & Parameters<typeof quote>[0]): Promise<PricingQuote> {
  const { source, ...selection } = input;
  const catalog: PublishedCatalog =
    source === "published" ? await getPublishedCatalog() : { version: 0, snapshot: await db.$transaction((tx) => buildCatalogSnapshot(tx)) };
  return quote(selection, catalog);
}

// ── Publish, history, rollback ────────────────────────────────────────────────

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as Prisma.PrismaClientKnownRequestError).code === "P2002";
}

/** Writes the draft out as the next immutable version. The caller has already checked the draft is valid. */
async function writeVersion(tx: TxClient, actorId: string, draft: CatalogSnapshot, auditAction: string, auditAfter: Record<string, unknown>) {
  const latest = await latestPublished(tx);
  const version = (latest?.version ?? 0) + 1;
  await tx.pricingVersion.create({ data: { version, snapshot: asJson(draft), publishedBy: actorId } });
  await writePricingAudit(tx, {
    actorId,
    entity: "PricingVersion",
    entityId: String(version),
    action: auditAction,
    after: asJson({ version, ...auditAfter })
  });
  return version;
}

export async function publish(actorId: string, note?: string): Promise<{ version: number }> {
  try {
    const version = await db.$transaction(async (tx) => {
      const [draft, latest] = await Promise.all([buildCatalogSnapshot(tx), latestPublished(tx)]);
      const changes = latest ? diffCatalogs(latest.snapshot as unknown as CatalogSnapshot, draft) : [];
      if (latest && changes.length === 0) throw conflict("Tidak ada perubahan untuk dipublikasikan");
      // The same checks the seed file passes: a draft that fails them is never published.
      parseSeed(snapshotToSeed(draft, (latest?.version ?? 0) + 1));
      return writeVersion(tx, actorId, draft, "PUBLISH", { note: note ?? null, changes: changes.length });
    });
    clearCatalogCache();
    return { version };
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Versi harga baru saja dipublikasikan oleh admin lain. Muat ulang lalu coba lagi.");
    throw err;
  }
}

export async function listVersions() {
  const rows = await db.pricingVersion.findMany({ orderBy: { version: "desc" }, select: { version: true, publishedBy: true, publishedAt: true } });
  return rows.map((r) => ({ version: r.version, publishedBy: r.publishedBy, publishedAt: r.publishedAt.toISOString() }));
}

export async function getVersion(version: number) {
  const row = await db.pricingVersion.findUnique({ where: { version } });
  if (!row) throw notFound(`Versi ${version} tidak ditemukan`);
  return { version: row.version, publishedBy: row.publishedBy, publishedAt: row.publishedAt.toISOString(), catalog: row.snapshot as unknown as CatalogSnapshot };
}

/** Restores the draft from an older version and publishes it as a new one, so history only ever grows. */
export async function rollback(actorId: string, target: number): Promise<{ version: number }> {
  try {
    const version = await db.$transaction(async (tx) => {
      const old = await tx.pricingVersion.findUnique({ where: { version: target } });
      if (!old) throw notFound(`Versi ${target} tidak ditemukan`);
      const latest = await latestPublished(tx);
      await applySeedToDraft(tx, parseSeed(snapshotToSeed(old.snapshot as unknown as CatalogSnapshot, (latest?.version ?? 0) + 1)));
      return writeVersion(tx, actorId, await buildCatalogSnapshot(tx), "ROLLBACK", { restoredFrom: target });
    });
    clearCatalogCache();
    return { version };
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Versi harga baru saja dipublikasikan oleh admin lain. Muat ulang lalu coba lagi.");
    throw err;
  }
}

// ── Import / export / audit ───────────────────────────────────────────────────

export async function exportDraft(): Promise<PricingSeed> {
  return db.$transaction(async (tx) => {
    const [draft, latest] = await Promise.all([buildCatalogSnapshot(tx), latestPublished(tx)]);
    return snapshotToSeed(draft, (latest?.version ?? 0) + 1);
  });
}

/** Loads a seed-shaped file into the draft. It does not publish. */
export async function importDraft(actorId: string, raw: unknown): Promise<{ changeCount: number }> {
  const seed = parseSeed(raw);
  return db.$transaction(async (tx) => {
    await applySeedToDraft(tx, seed);
    await writePricingAudit(tx, {
      actorId,
      entity: "PricingVersion",
      action: "IMPORT",
      after: asJson({ packages: seed.packages.length, features: seed.features.length })
    });
    const [draft, latest] = await Promise.all([buildCatalogSnapshot(tx), latestPublished(tx)]);
    return { changeCount: latest ? diffCatalogs(latest.snapshot as unknown as CatalogSnapshot, draft).length : 0 };
  });
}

export async function listAudit(limit = 100) {
  const rows = await db.pricingAuditLog.findMany({ orderBy: [{ at: "desc" }, { id: "desc" }], take: Math.min(limit, 500) });
  return rows.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    entity: r.entity,
    entityId: r.entityId,
    action: r.action,
    before: r.before,
    after: r.after,
    at: r.at.toISOString()
  }));
}

// ── Tenant subscription (platform admin) ──────────────────────────────────────

function subscriptionView(sub: Prisma.TenantSubscriptionGetPayload<{ include: { package: true; supportPlan: true } }>) {
  const snapshot = sub.snapshot as unknown as SubscriptionSnapshot;
  return {
    packageCode: snapshot.packageCode,
    packageName: snapshot.packageName,
    status: sub.status,
    billingCycle: sub.billingCycle,
    amountPerCycle: sub.amountPerCycle.toFixed(2),
    pricingVersion: sub.pricingVersion,
    nextBillingDate: sub.nextBillingDate?.toISOString() ?? null,
    supportPlanCode: sub.supportPlan?.code ?? null,
    selectedFeatureKeys: sub.selectedFeatureKeys,
    addons: sub.addons,
    limitOverrides: sub.limitOverrides,
    createdVia: sub.createdVia
  };
}

export async function setTenantSubscription(actorId: string, tenantId: string, input: Input<typeof tenantSubscriptionSchema>) {
  const { limitOverrides, nextBillingDate, status, ...selection } = input;
  const published = await getPublishedCatalog();
  // The admin may assign a hidden package, so this is not publicOnly. It is still engine-priced.
  const subscriptionSnapshot = buildSubscriptionSnapshot(selection, published);
  const priced = quote(selection, published);

  const result = await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw notFound("Koperasi tidak ditemukan");
    const pkg = await tx.subscriptionPackage.findUniqueOrThrow({ where: { code: selection.packageCode } });
    const supportPlan = selection.supportPlanCode ? await tx.supportPlan.findUnique({ where: { code: selection.supportPlanCode } }) : null;

    const include = { package: true, supportPlan: true } as const;
    const existing = await withoutTenantScope(async () => tx.tenantSubscription.findUnique({ where: { tenantId }, include }));
    const free = new Prisma.Decimal(priced.amountPerCycle).isZero();
    const next = free
      ? null
      : nextBillingDate !== undefined
        ? nextBillingDate
        : (existing?.nextBillingDate ?? addMonths(new Date(), selection.billingCycle === "YEARLY" ? 12 : 1));

    const data = {
      packageId: pkg.id,
      pricingVersion: published.version,
      billingCycle: selection.billingCycle,
      supportPlanId: supportPlan?.id ?? null,
      selectedFeatureKeys: selection.featureKeys ?? [],
      addons: asJson(Object.fromEntries((selection.addons ?? []).map((a) => [a.itemKey, a.qty]))),
      snapshot: asJson(subscriptionSnapshot),
      amountPerCycle: new Prisma.Decimal(priced.amountPerCycle),
      status: status ?? existing?.status ?? "ACTIVE",
      nextBillingDate: next,
      ...(limitOverrides !== undefined ? { limitOverrides: limitOverrides as Json } : {})
    };
    const saved = await withoutTenantScope(async () =>
      tx.tenantSubscription.upsert({
        where: { tenantId },
        create: { tenantId, startsAt: new Date(), createdVia: "ADMIN", ...data },
        update: data,
        include
      })
    );
    // Tenant.packageId and nextBillingDate stay as denormalized pointers for the existing billing code.
    await tx.tenant.update({ where: { id: tenantId }, data: { packageId: pkg.id, nextBillingDate: next } });

    await writePricingAudit(tx, {
      actorId,
      entity: "TenantSubscription",
      entityId: tenantId,
      action: existing ? "UPDATE" : "CREATE",
      before: existing ? asJson(subscriptionView(existing)) : null,
      after: asJson(subscriptionView(saved))
    });
    return subscriptionView(saved);
  });

  clearEntitlementCache(tenantId);
  return result;
}

export async function getTenantSubscription(tenantId: string): Promise<{
  subscription: ReturnType<typeof subscriptionView> | null;
  features: string[];
  limits: PricingLimits | null;
  usage: TenantSubscriptionInfo["usage"];
}> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw notFound("Koperasi tidak ditemukan");
  const sub = await withoutTenantScope(async () =>
    db.tenantSubscription.findUnique({ where: { tenantId }, include: { package: true, supportPlan: true } })
  );
  const usage = await getUsage(tenantId);
  if (!sub) return { subscription: null, features: [], limits: null, usage };
  const ent = resolveEntitlements({
    snapshot: sub.snapshot as unknown as SubscriptionSnapshot,
    limitOverrides: sub.limitOverrides as Partial<PricingLimits> | null
  });
  return { subscription: subscriptionView(sub), features: ent.features, limits: ent.limits, usage };
}
