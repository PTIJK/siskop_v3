import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { isMultiUnit, type CooperativeUnit } from "@siskop/types";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, setupTenant } from "./helpers.js";

/**
 * Regression lock for the Day 1 KSU spike: a freshly registered (single-unit)
 * tenant already gets exactly one active CooperativeUnit, `isMultiUnit`
 * already derives `false` for it (no stored `Tenant.isMultiUnit` flag exists
 * or should exist — see CLAUDE.md rule 2b), and every Saving row already
 * carries that unit's id via a required `unitId`. This file adds no new
 * behavior; it characterizes what's already there before Day 2+ touches
 * loan/saving creation.
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("KSU baseline: single-unit tenant", () => {
  it("has exactly one active CooperativeUnit after registration", async () => {
    const admin = await setupTenant();

    const units = await db.cooperativeUnit.findMany({ where: { tenantId: admin.user.tenantId } });

    expect(units).toHaveLength(1);
    expect(units[0].isActive).toBe(true);
  });

  it("derives isMultiUnit(units) as false for a single-unit tenant", async () => {
    const admin = await setupTenant();

    const units = await db.cooperativeUnit.findMany({ where: { tenantId: admin.user.tenantId } });

    expect(isMultiUnit(units as unknown as CooperativeUnit[])).toBe(false);
  });

  it("stamps a member's Saving row with the tenant's single unit id", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    const member = await createMemberWithPokokSaving(admin.accessToken);
    const saving = await db.saving.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, memberId: member.id }
    });

    expect(saving.unitId).not.toBeNull();
    expect(saving.unitId).toBe(unit.id);
  });
});

/**
 * Day 2: `createLoan` gains an optional, explicit `unitId` so a multi-unit
 * tenant can route a loan to a specific CooperativeUnit — additive on top of
 * the Day 1 baseline above. Every existing call site (no `unitId` supplied)
 * must keep resolving through `getDefaultUnitId` exactly as before; a
 * supplied `unitId` must be validated as an active unit owned by the calling
 * tenant, never trusted at face value (cross-tenant isolation, CLAUDE.md #1).
 */

const KUR_MIKRO = {
  name: "KUR Mikro",
  type: "KONVENSIONAL" as const,
  rateType: "BUNGA" as const,
  rate: 12,
  maxTermMonths: 36
};

async function createLoanConfigAs(accessToken: string) {
  const res = await request(app())
    .post("/api/loans/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(KUR_MIKRO);
  return res.body.data as { id: string };
}

async function createSecondUnit(accessToken: string) {
  const res = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type: "KONSUMEN", name: "Unit Konsumen" });
  return res.body.data as { id: string };
}

describe("KSU Day 2: explicit unitId on loan creation", () => {
  it("creates the loan against an explicitly provided second unit, not the tenant's default unit", async () => {
    const admin = await setupTenant();
    const defaultUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const secondUnit = await createSecondUnit(admin.accessToken);
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 1_000_000,
        termMonths: 6,
        unitId: secondUnit.id
      });

    expect(res.status).toBe(201);
    const loan = await db.loan.findUnique({ where: { id: res.body.data.id } });
    expect(loan?.unitId).toBe(secondUnit.id);
    expect(loan?.unitId).not.toBe(defaultUnit.id);
  });

  it("still resolves to the tenant's default unit when unitId is omitted, even with a second unit present", async () => {
    const admin = await setupTenant();
    const defaultUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    await createSecondUnit(admin.accessToken);
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });

    expect(res.status).toBe(201);
    const loan = await db.loan.findUnique({ where: { id: res.body.data.id } });
    expect(loan?.unitId).toBe(defaultUnit.id);
  });

  it("rejects a unitId belonging to a different tenant instead of silently cross-linking the loan", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: tenantB.user.tenantId } });
    const member = await createMemberWithPokokSaving(tenantA.accessToken);
    const config = await createLoanConfigAs(tenantA.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 1_000_000,
        termMonths: 6,
        unitId: unitB.id
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const loanCount = await db.loan.count({ where: { tenantId: tenantA.user.tenantId } });
    expect(loanCount).toBe(0);
  });

  it("rejects a unitId that does not exist at all", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const ghost = await createSecondUnit(admin.accessToken);
    await db.cooperativeUnit.delete({ where: { id: ghost.id, tenantId: admin.user.tenantId } });

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 1_000_000,
        termMonths: 6,
        unitId: ghost.id
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
