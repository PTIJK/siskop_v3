import express from "express";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode, type PricingLimits, type PricingSelection } from "@siskop/types";
import { db } from "../src/lib/db.js";
import { AppError } from "../src/lib/errors.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { buildSubscriptionSnapshot } from "../src/lib/pricing/engine.js";
import { clearEntitlementCache, getTenantEntitlements, getUsage, withQuota } from "../src/lib/pricing/entitlements.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import type { CatalogSnapshot } from "../src/lib/pricing/snapshot.js";
import { requireFeature } from "../src/middleware/feature.js";
import { setupTenant } from "./helpers.js";
import { seedJson } from "./pricing-fixture.js";

let published: { version: number; snapshot: CatalogSnapshot };

beforeAll(async () => {
  await db.packageFeature.deleteMany({});
  await db.feature.deleteMany({});
  await db.subscriptionPackage.deleteMany({ where: { code: { not: null } } });
  await db.volumeAddon.deleteMany({});
  await db.supportPlan.deleteMany({});
  await db.pricingSetting.deleteMany({});
  await db.pricingVersion.deleteMany({});
  await db.pricingAuditLog.deleteMany({});
  await loadPricingSeed(db, parsePricingSeed(seedJson()));
  const v = await db.pricingVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
  published = { version: v.version, snapshot: v.snapshot as unknown as CatalogSnapshot };
});

beforeEach(() => {
  clearEntitlementCache();
  process.env.PRICING_V2_ENFORCEMENT = "on";
});
afterEach(async () => {
  delete process.env.PRICING_V2_ENFORCEMENT;
  await withoutTenantScope(async () => db.tenantSubscription.deleteMany({}));
  await db.tenant.deleteMany({});
});

let seq = 0;
/** A registered tenant with an ACTIVE subscription built by the real engine. */
async function subscribedTenant(
  selection: Partial<PricingSelection> & { packageCode: string },
  extra: { limitOverrides?: Partial<PricingLimits>; status?: "ACTIVE" | "CANCELLED" } = {}
) {
  seq += 1;
  const session = await setupTenant({ slug: `ent-${seq}`, registrationNo: `ENT-${seq}`, adminEmail: `a${seq}@ent.test` });
  const tenantId = session.user.tenantId;
  const snapshot = buildSubscriptionSnapshot({ billingCycle: "MONTHLY", ...selection }, published);
  const pkg = await db.subscriptionPackage.findUniqueOrThrow({ where: { code: selection.packageCode } });
  await db.tenantSubscription.create({
    data: {
      tenantId,
      packageId: pkg.id,
      pricingVersion: published.version,
      billingCycle: "MONTHLY",
      snapshot: snapshot as never,
      amountPerCycle: 0,
      status: extra.status ?? "ACTIVE",
      startsAt: new Date(),
      createdVia: "ADMIN",
      limitOverrides: (extra.limitOverrides ?? undefined) as never
    }
  });
  return tenantId;
}

async function addMembers(tenantId: string, n: number, from = 0) {
  await db.member.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      tenantId,
      memberId: `${tenantId}-m${from + i}`,
      accountNumber: `${tenantId}-a${from + i}`,
      fullName: `Anggota ${from + i}`,
      nik: `${from + i}`.padStart(16, "0"),
      address: "x",
      birthPlace: "x",
      birthDate: new Date("1990-01-01"),
      occupation: "x"
    }))
  });
}
const newMember = (tx: Pick<typeof db, "member">, tenantId: string, tag: string) =>
  tx.member.create({
    data: {
      tenantId,
      memberId: `${tenantId}-${tag}`,
      accountNumber: `${tenantId}-${tag}-acc`,
      fullName: tag,
      nik: tag.padStart(16, "9"),
      address: "x",
      birthPlace: "x",
      birthDate: new Date("1990-01-01"),
      occupation: "x"
    }
  });

/** Pauses between the quota check and the insert so two callers genuinely overlap. */
const slowInsert = (tenantId: string, tag: string) => async (tx: Pick<typeof db, "member">) => {
  await new Promise((r) => setTimeout(r, 300));
  return newMember(tx, tenantId, tag);
};

describe("getTenantEntitlements", () => {
  it("returns null for a tenant with no subscription", async () => {
    const session = await setupTenant({ slug: "ent-none", registrationNo: "ENT-NONE", adminEmail: "none@ent.test" });
    expect(await getTenantEntitlements(session.user.tenantId)).toBeNull();
  });

  it("returns the snapshot's features and limits with the tenant's overrides applied", async () => {
    const tenantId = await subscribedTenant({ packageCode: "free" }, { limitOverrides: { members: 60 } });

    const ent = await getTenantEntitlements(tenantId);

    expect(ent?.packageCode).toBe("free");
    expect(ent?.hasFeature("config_coa")).toBe(true);
    expect(ent?.hasFeature("accounting_book")).toBe(false);
    expect(ent?.limits).toEqual({ members: 60, users: 1, savingTypes: 2, loanTypes: 2 });
    expect(ent?.status).toBe("ACTIVE");
  });

  it("serves from cache for 60 seconds, then rereads", async () => {
    const tenantId = await subscribedTenant({ packageCode: "free" });
    const t0 = 1_000_000;
    expect((await getTenantEntitlements(tenantId, t0))?.limits.members).toBe(50);

    await db.tenantSubscription.update({ where: { tenantId }, data: { limitOverrides: { members: 99 } } });

    expect((await getTenantEntitlements(tenantId, t0 + 59_000))?.limits.members).toBe(50);
    expect((await getTenantEntitlements(tenantId, t0 + 61_000))?.limits.members).toBe(99);
  });

  it("clearEntitlementCache drops one tenant, or all", async () => {
    const tenantId = await subscribedTenant({ packageCode: "free" });
    await getTenantEntitlements(tenantId, 5);
    await db.tenantSubscription.update({ where: { tenantId }, data: { limitOverrides: { members: 70 } } });

    clearEntitlementCache(tenantId);

    expect((await getTenantEntitlements(tenantId, 6))?.limits.members).toBe(70);
  });

  it("keeps two tenants on different packages apart", async () => {
    const free = await subscribedTenant({ packageCode: "free" });
    const small = await subscribedTenant({ packageCode: "small" });

    const [a, b] = await Promise.all([getTenantEntitlements(free), getTenantEntitlements(small)]);

    expect(a?.hasFeature("period_closing")).toBe(false);
    expect(b?.hasFeature("period_closing")).toBe(true);
    expect(a?.limits.members).toBe(50);
    expect(b?.limits.members).toBe(500);
  });

  it("grants no features to a cancelled subscription", async () => {
    const tenantId = await subscribedTenant({ packageCode: "small" }, { status: "CANCELLED" });

    const ent = await getTenantEntitlements(tenantId);

    expect(ent?.status).toBe("CANCELLED");
    expect(ent?.features).toEqual([]);
    expect(ent?.hasFeature("dashboard")).toBe(false);
  });
});

describe("getUsage", () => {
  it("counts only this tenant's active members, users, saving types and loan types", async () => {
    const mine = await subscribedTenant({ packageCode: "small" });
    const other = await subscribedTenant({ packageCode: "small" });
    await addMembers(mine, 3);
    await addMembers(other, 7, 100);
    await db.member.updateMany({ where: { tenantId: mine, memberId: `${mine}-m0` }, data: { isActive: false } });
    await db.savingConfig.create({
      data: { tenantId: mine, name: "Wajib", type: "WAJIB", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" }
    });

    const usage = await getUsage(mine);

    expect(usage.members).toBe(2);
    expect(usage.users).toBe(1);
    expect(usage.savingTypes).toBe(1);
    expect(usage.loanTypes).toBe(0);
  });
});

describe("withQuota", () => {
  it("runs the work while under the limit", async () => {
    const tenantId = await subscribedTenant({ packageCode: "free" });
    await addMembers(tenantId, 49);

    await withQuota(tenantId, "MEMBERS", (tx) => newMember(tx, tenantId, "ke50"));

    expect(await db.member.count({ where: { tenantId } })).toBe(50);
  });

  it("rejects the 51st member on Free with QUOTA_EXCEEDED and does not run the work", async () => {
    const tenantId = await subscribedTenant({ packageCode: "free" });
    await addMembers(tenantId, 50);
    const work = vi.fn();

    const err = await withQuota(tenantId, "MEMBERS", work).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ErrorCode.QUOTA_EXCEEDED);
    expect((err as AppError).status).toBe(403);
    expect((err as AppError).details).toEqual({ item: "MEMBERS", limit: 50, used: 50 });
    expect(work).not.toHaveBeenCalled();
  });

  it("honours a per-tenant limit override", async () => {
    const tenantId = await subscribedTenant({ packageCode: "free" }, { limitOverrides: { members: 53 } });
    await addMembers(tenantId, 52);

    await withQuota(tenantId, "MEMBERS", (tx) => newMember(tx, tenantId, "ke53"));
    const err = await withQuota(tenantId, "MEMBERS", (tx) => newMember(tx, tenantId, "ke54")).catch((e: unknown) => e);

    expect((err as AppError).code).toBe(ErrorCode.QUOTA_EXCEEDED);
  });

  it("never blocks an unlimited dimension", async () => {
    const tenantId = await subscribedTenant({ packageCode: "enterprise" });
    await expect(withQuota(tenantId, "USERS", async () => "ok")).resolves.toBe("ok");
  });

  it("blocks an import that would cross the limit when told how many rows it adds", async () => {
    const tenantId = await subscribedTenant({ packageCode: "free" });
    await addMembers(tenantId, 45);

    const err = await withQuota(tenantId, "MEMBERS", async () => "ok", { adding: 10 }).catch((e: unknown) => e);

    expect((err as AppError).details).toEqual({ item: "MEMBERS", limit: 50, used: 45 });
  });

  it("lets exactly one of two concurrent creates through at 49 of 50", async () => {
    const tenantId = await subscribedTenant({ packageCode: "free" });
    await addMembers(tenantId, 49);

    const results = await Promise.allSettled([
      withQuota(tenantId, "MEMBERS", slowInsert(tenantId, "race-a")),
      withQuota(tenantId, "MEMBERS", slowInsert(tenantId, "race-b"))
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as AppError).code).toBe(ErrorCode.QUOTA_EXCEEDED);
    expect(await db.member.count({ where: { tenantId } })).toBe(50);
  });

  it("denies a tenant with no subscription when enforcement is on", async () => {
    const session = await setupTenant({ slug: "q-none", registrationNo: "Q-NONE", adminEmail: "q@none.test" });
    const err = await withQuota(session.user.tenantId, "MEMBERS", async () => "ok").catch((e: unknown) => e);
    expect((err as AppError).code).toBe(ErrorCode.FEATURE_NOT_ENTITLED);
  });

  it("does not check at all when enforcement is off", async () => {
    process.env.PRICING_V2_ENFORCEMENT = "off";
    const tenantId = await subscribedTenant({ packageCode: "free" });
    await addMembers(tenantId, 50);

    await expect(withQuota(tenantId, "MEMBERS", async () => "ok")).resolves.toBe("ok");
  });

  it("in shadow mode logs the breach and still runs the work", async () => {
    process.env.PRICING_V2_ENFORCEMENT = "shadow";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tenantId = await subscribedTenant({ packageCode: "free" });
    await addMembers(tenantId, 50);

    await expect(withQuota(tenantId, "MEMBERS", async () => "ok")).resolves.toBe("ok");

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("QUOTA_EXCEEDED"));
    warn.mockRestore();
  });
});

describe("requireFeature middleware", () => {
  function appFor(tenantId: string, key: string) {
    const app = express();
    app.use((req, res, next) => {
      req.auth = { tenantId } as never;
      res.locals.meta = {};
      next();
    });
    app.get("/gated", requireFeature(key), (_req, res) => res.json({ ok: true }));
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const e = err as AppError;
      res.status(e.status ?? 500).json({ code: e.code, details: e.details });
    });
    return app;
  }

  it("lets an entitled tenant through", async () => {
    const tenantId = await subscribedTenant({ packageCode: "small" });
    const res = await request(appFor(tenantId, "period_closing")).get("/gated");
    expect(res.status).toBe(200);
  });

  it("returns 403 FEATURE_NOT_ENTITLED for a package without the feature", async () => {
    const tenantId = await subscribedTenant({ packageCode: "small" });
    const res = await request(appFor(tenantId, "manual_journal")).get("/gated");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: ErrorCode.FEATURE_NOT_ENTITLED, details: { feature: "manual_journal" } });
  });

  it("denies a tenant with no subscription when enforcement is on", async () => {
    const session = await setupTenant({ slug: "f-none", registrationNo: "F-NONE", adminEmail: "f@none.test" });
    const res = await request(appFor(session.user.tenantId, "dashboard")).get("/gated");
    expect(res.status).toBe(403);
  });

  it("passes everything when enforcement is off", async () => {
    process.env.PRICING_V2_ENFORCEMENT = "off";
    const tenantId = await subscribedTenant({ packageCode: "free" });
    const res = await request(appFor(tenantId, "manual_journal")).get("/gated");
    expect(res.status).toBe(200);
  });

  it("in shadow mode logs and passes", async () => {
    process.env.PRICING_V2_ENFORCEMENT = "shadow";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tenantId = await subscribedTenant({ packageCode: "free" });
    const res = await request(appFor(tenantId, "manual_journal")).get("/gated");
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("FEATURE_NOT_ENTITLED"));
    warn.mockRestore();
  });

  it("does not leak entitlements between two tenants on different packages", async () => {
    const free = await subscribedTenant({ packageCode: "free" });
    const small = await subscribedTenant({ packageCode: "small" });
    expect((await request(appFor(free, "period_closing")).get("/gated")).status).toBe(403);
    expect((await request(appFor(small, "period_closing")).get("/gated")).status).toBe(200);
  });
});
