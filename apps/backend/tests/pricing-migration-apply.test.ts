import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { clearCatalogCache } from "../src/lib/pricing/catalog.js";
import { clearEntitlementCache, getTenantEntitlements } from "../src/lib/pricing/entitlements.js";
import { applySubscriptionMigration } from "../src/lib/pricing/migration.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { provisionTenant } from "../src/modules/tenants/provision.js";
import { seedJson } from "./pricing-fixture.js";

async function resetAll() {
  await db.notification.deleteMany({});
  await withoutTenantScope(async () => db.tenantSubscription.deleteMany({}));
  await db.tenant.deleteMany({});
  await db.packageFeature.deleteMany({});
  await db.feature.deleteMany({});
  await db.subscriptionPackage.deleteMany({});
  await db.volumeAddon.deleteMany({});
  await db.supportPlan.deleteMany({});
  await db.pricingSetting.deleteMany({});
  await db.pricingVersion.deleteMany({});
  await db.pricingAuditLog.deleteMany({});
}

beforeEach(async () => {
  await resetAll();
  await loadPricingSeed(db, parsePricingSeed(seedJson()));
  clearCatalogCache();
  clearEntitlementCache();
});
afterEach(resetAll);

let seq = 0;
async function tenantOn(legacy: { id: string } | null, extra: { nextBillingDate?: Date; members?: number; isActive?: boolean } = {}) {
  seq += 1;
  const { tenant } = await provisionTenant({
    name: `Koperasi ${seq}`,
    slug: `mig-${seq}`,
    registrationNo: `MIG-${seq}`,
    address: "Jl. Uji",
    type: "KONVENSIONAL",
    firstUnit: { type: "KSP", name: "Simpan Pinjam" }
  });
  await db.tenant.update({
    where: { id: tenant.id },
    data: { packageId: legacy?.id ?? null, nextBillingDate: extra.nextBillingDate ?? null, isActive: extra.isActive ?? true }
  });
  for (let i = 0; i < (extra.members ?? 0); i += 1) {
    await db.member.create({
      data: {
        tenantId: tenant.id,
        memberId: `M${seq}-${i}`,
        accountNumber: `A${seq}-${i}`,
        fullName: `Anggota ${i}`,
        nik: `${seq}`.padStart(6, "0") + `${i}`.padStart(10, "0"),
        address: "x",
        birthPlace: "x",
        birthDate: new Date("1990-01-01"),
        occupation: "x"
      }
    });
  }
  return tenant;
}

const legacyPackage = (over: Record<string, unknown> = {}) =>
  db.subscriptionPackage.create({ data: { name: "Paket Lama", price: 750_000, modules: [], maxUsers: 10, maxMembers: 100, ...over } });
const subOf = (tenantId: string) => withoutTenantScope(async () => db.tenantSubscription.findUnique({ where: { tenantId } }));

describe("applySubscriptionMigration", () => {
  it("creates an active subscription that keeps the current price and billing date", async () => {
    const legacy = await legacyPackage({ price: 750_000 });
    const due = new Date("2026-12-15T00:00:00.000Z");
    const tenant = await tenantOn(legacy, { nextBillingDate: due });

    const result = await applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true });

    expect(result.created).toBe(1);
    const sub = await subOf(tenant.id);
    expect(sub).toMatchObject({ status: "ACTIVE", billingCycle: "MONTHLY", createdVia: "MIGRATION" });
    expect(sub?.amountPerCycle.toString()).toBe("750000");
    expect(sub?.nextBillingDate?.toISOString()).toBe(due.toISOString());
    expect((sub?.snapshot as { packageCode: string }).packageCode).toBe("small");
    expect(sub?.pricingVersion).toBe(1);
  });

  it("leaves the legacy package link alone so the old flags keep working until they are dropped", async () => {
    const legacy = await legacyPackage();
    const tenant = await tenantOn(legacy);
    await applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true });
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).packageId).toBe(legacy.id);
  });

  it("records a limit override where usage exceeds the new package, and never trims", async () => {
    const legacy = await legacyPackage({ maxMembers: null });
    const tenant = await tenantOn(legacy, { members: 3 });
    // The tenant gets what the owner PUBLISHED, so shrink Free there: 3 members against a limit of 2.
    const v1 = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
    const snap = structuredClone(v1.snapshot) as { packages: { code: string; limits: { members: number | null } }[] };
    snap.packages.find((p) => p.code === "free")!.limits.members = 2;
    await db.pricingVersion.update({ where: { version: 1 }, data: { snapshot: snap as never } });
    clearCatalogCache();

    const result = await applySubscriptionMigration(db, { mapping: { [legacy.id]: "free" }, allowFeatureLoss: true });

    expect(result.created).toBe(1);
    const sub = await subOf(tenant.id);
    expect(sub?.limitOverrides).toEqual({ members: 3 });
    expect((await getTenantEntitlements(tenant.id))?.limits.members).toBe(3);
    expect(await db.member.count({ where: { tenantId: tenant.id } })).toBe(3);
  });

  it("is safe to run again: tenants already migrated are skipped", async () => {
    const legacy = await legacyPackage();
    await tenantOn(legacy);
    await applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true });
    const again = await applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true });
    expect(again).toMatchObject({ created: 0, alreadyMigrated: 1 });
    expect(await withoutTenantScope(async () => db.tenantSubscription.count())).toBe(1);
  });

  it("keeps access identical: a tenant with the accounting and whitelabel add-ons keeps those features", async () => {
    const legacy = await legacyPackage({ modules: ["accounting"], whitelabelEnabled: true, customSubdomainEnabled: true });
    const tenant = await tenantOn(legacy);

    const result = await applySubscriptionMigration(db, { mapping: { [legacy.id]: "enterprise" } });

    expect(result.created).toBe(1);
    const ent = await getTenantEntitlements(tenant.id);
    for (const key of ["accounting_book", "manual_journal", "reports_regulatory", "whitelabel", "workspace_address"]) {
      expect(ent?.hasFeature(key), key).toBe(true);
    }
  });

  it("refuses a tenant that would lose access, and says which features, unless the owner allows it", async () => {
    const legacy = await legacyPackage({ modules: ["accounting"] });
    const tenant = await tenantOn(legacy);

    const blocked = await applySubscriptionMigration(db, { mapping: { [legacy.id]: "free" } });
    expect(blocked.created).toBe(0);
    expect(blocked.blockedByFeatureLoss).toHaveLength(1);
    expect(blocked.blockedByFeatureLoss[0]).toMatchObject({ tenantId: tenant.id });
    expect(blocked.blockedByFeatureLoss[0]?.featuresLost).toContain("accounting_book");
    expect(await subOf(tenant.id)).toBeNull();

    const allowed = await applySubscriptionMigration(db, { mapping: { [legacy.id]: "free" }, allowFeatureLoss: true });
    expect(allowed.created).toBe(1);
  });

  it("skips an inactive koperasi and reports it instead of subscribing it", async () => {
    const legacy = await legacyPackage();
    const inactive = await tenantOn(legacy, { isActive: false });
    const result = await applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true });
    expect(result.created).toBe(0);
    expect(result.skippedInactive.map((r) => r.tenantId)).toEqual([inactive.id]);
    expect(await subOf(inactive.id)).toBeNull();
  });

  it("reports unmapped tenants and touches nothing for them", async () => {
    const mapped = await legacyPackage({ name: "Dipetakan" });
    const other = await legacyPackage({ name: "Belum dipetakan" });
    const a = await tenantOn(mapped);
    const b = await tenantOn(other);
    const result = await applySubscriptionMigration(db, { mapping: { [mapped.id]: "small" }, allowFeatureLoss: true });
    expect(result.created).toBe(1);
    expect(result.unmapped.map((u) => u.tenantId)).toEqual([b.id]);
    expect(await subOf(a.id)).not.toBeNull();
    expect(await subOf(b.id)).toBeNull();
  });

  it("one tenant failing does not stop the rest, and the failure is reported", async () => {
    const legacy = await legacyPackage();
    const first = await tenantOn(legacy);
    const second = await tenantOn(legacy);
    // The first tenant's write fails (a dropped connection, say); the run carries on.
    vi.spyOn(db, "$transaction").mockRejectedValueOnce(new Error("connection lost"));

    const result = await applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true });
    vi.restoreAllMocks();

    expect(result.created).toBe(1);
    expect(result.failed).toEqual([{ tenantId: first.id, tenantName: first.name, reason: "connection lost" }]);
    expect(await subOf(first.id)).toBeNull();
    expect(await subOf(second.id)).not.toBeNull();

    // Running again picks up the one that failed.
    expect((await applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true })).created).toBe(1);
  });

  it("writes an audit entry per migrated tenant and clears cached entitlements", async () => {
    const legacy = await legacyPackage();
    const tenant = await tenantOn(legacy);
    expect(await getTenantEntitlements(tenant.id)).toBeNull();
    await applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true });
    const audit = await db.pricingAuditLog.findMany({ where: { entity: "subscription", entityId: tenant.id, action: "MIGRATED" } });
    expect(audit).toHaveLength(1);
    expect((await getTenantEntitlements(tenant.id))?.packageCode).toBe("small");
  });

  it("refuses to run before the owner has published a catalog", async () => {
    const legacy = await legacyPackage();
    await tenantOn(legacy);
    await db.pricingVersion.deleteMany({});
    clearCatalogCache();
    await expect(applySubscriptionMigration(db, { mapping: { [legacy.id]: "small" }, allowFeatureLoss: true })).rejects.toThrow();
  });

  it("rejects a mapping that points at an unknown package, before changing anything", async () => {
    const legacy = await legacyPackage();
    const tenant = await tenantOn(legacy);
    await expect(applySubscriptionMigration(db, { mapping: { [legacy.id]: "platinum" } })).rejects.toThrow(/unknown package/i);
    expect(await subOf(tenant.id)).toBeNull();
  });
});
