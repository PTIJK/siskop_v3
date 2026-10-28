import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { planSubscriptionMigration } from "../src/lib/pricing/migration.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import { provisionTenant } from "../src/modules/tenants/provision.js";

const SEED_PATH = resolve(__dirname, "../../../docs/package-modules/pricing.seed.json");

async function resetAll() {
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
  await loadPricingSeed(db, parsePricingSeed(JSON.parse(readFileSync(SEED_PATH, "utf8"))));
});
afterEach(resetAll);

let seq = 0;
async function tenantOn(legacy: { id: string } | null, extra: { nextBillingDate?: Date; members?: number } = {}) {
  seq += 1;
  const { tenant } = await provisionTenant({
    name: `Koperasi ${seq}`,
    slug: `kop-${seq}`,
    registrationNo: `REG-${seq}`,
    address: "Jl. Uji",
    type: "KONVENSIONAL",
    firstUnit: { type: "KSP", name: "Simpan Pinjam" }
  });
  await db.tenant.update({
    where: { id: tenant.id },
    data: { packageId: legacy?.id ?? null, nextBillingDate: extra.nextBillingDate ?? null }
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
  db.subscriptionPackage.create({
    data: { name: "Paket Lama", price: 750_000, modules: [], maxUsers: 10, maxMembers: 100, ...over }
  });

describe("planSubscriptionMigration (dry run)", () => {
  it("keeps the tenant's current price and billing date and maps to the approved package", async () => {
    const legacy = await legacyPackage({ price: 750_000 });
    const due = new Date("2026-12-15T00:00:00.000Z");
    const tenant = await tenantOn(legacy, { nextBillingDate: due });

    const plan = await planSubscriptionMigration(db, { mapping: { [legacy.id]: "small" } });

    expect(plan.unmapped).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({
      tenantId: tenant.id,
      targetPackageCode: "small",
      billingCycle: "MONTHLY",
      amountPerCycle: "750000",
      nextBillingDate: due.toISOString(),
      createdVia: "MIGRATION"
    });
  });

  it("lists tenants whose legacy package has no approved mapping instead of guessing", async () => {
    const legacy = await legacyPackage();
    const tenant = await tenantOn(legacy);

    const plan = await planSubscriptionMigration(db, { mapping: {} });

    expect(plan.rows).toEqual([]);
    expect(plan.unmapped.map((u) => u.tenantId)).toEqual([tenant.id]);
    expect(plan.unmapped[0]).toMatchObject({ legacyPackageId: legacy.id });
  });

  it("maps package-less tenants through the 'none' key at price 0", async () => {
    const tenant = await tenantOn(null);

    const plan = await planSubscriptionMigration(db, { mapping: { none: "free" } });

    expect(plan.rows[0]).toMatchObject({ tenantId: tenant.id, targetPackageCode: "free", amountPerCycle: "0" });
  });

  it("adds a limit override only for dimensions where usage exceeds the target limit", async () => {
    const legacy = await legacyPackage();
    await tenantOn(legacy, { members: 53 });

    const plan = await planSubscriptionMigration(db, { mapping: { [legacy.id]: "free" } });

    expect(plan.rows[0]!.usage.members).toBe(53);
    expect(plan.rows[0]!.limitOverrides).toEqual({ members: 53 });
  });

  it("does not override when usage fits, or when the target limit is unlimited", async () => {
    const legacy = await legacyPackage();
    await tenantOn(legacy, { members: 3 });

    const plan = await planSubscriptionMigration(db, { mapping: { [legacy.id]: "enterprise" } });

    expect(plan.rows[0]!.limitOverrides).toEqual({});
  });

  it("reports features a tenant has today but would lose on the target package", async () => {
    const legacy = await legacyPackage({ modules: ["accounting"], whitelabelEnabled: true });
    await tenantOn(legacy);

    const plan = await planSubscriptionMigration(db, { mapping: { [legacy.id]: "small" } });
    const row = plan.rows[0]!;

    // Accounting and whitelabel are entitled today. Small has accounting_book but not whitelabel.
    expect(row.featuresLost).toContain("whitelabel");
    expect(row.featuresLost).not.toContain("accounting_book");
    // Ungated-today features that Small does not include are lost too.
    expect(row.featuresLost).toContain("member_portal");
  });

  it("does not report gated features a tenant never had as lost", async () => {
    const legacy = await legacyPackage({ modules: [], whitelabelEnabled: false });
    await tenantOn(legacy);

    const plan = await planSubscriptionMigration(db, { mapping: { [legacy.id]: "free" } });

    expect(plan.rows[0]!.featuresLost).not.toContain("whitelabel");
    expect(plan.rows[0]!.featuresLost).not.toContain("accounting_book");
    expect(plan.rows[0]!.featuresGained).toContain("config_coa");
  });

  it("rejects a mapping to a package code that does not exist", async () => {
    const legacy = await legacyPackage();
    await tenantOn(legacy);

    await expect(planSubscriptionMigration(db, { mapping: { [legacy.id]: "platinum" } })).rejects.toThrow(/platinum/);
  });

  it("writes nothing: a dry run creates no subscriptions", async () => {
    const legacy = await legacyPackage();
    await tenantOn(legacy);

    await planSubscriptionMigration(db, { mapping: { [legacy.id]: "small" } });

    expect(await withoutTenantScope(async () => db.tenantSubscription.count())).toBe(0);
  });

  it("skips tenants that already have a subscription", async () => {
    const legacy = await legacyPackage();
    const tenant = await tenantOn(legacy);
    const small = await db.subscriptionPackage.findUniqueOrThrow({ where: { code: "small" } });
    await db.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        packageId: small.id,
        pricingVersion: 1,
        billingCycle: "MONTHLY",
        snapshot: {},
        amountPerCycle: 500_000,
        status: "ACTIVE",
        startsAt: new Date(),
        createdVia: "ADMIN"
      }
    });

    const plan = await planSubscriptionMigration(db, { mapping: { [legacy.id]: "small" } });

    expect(plan.rows).toEqual([]);
    expect(plan.alreadyMigrated).toBe(1);
  });
});
