import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { isMultiUnit, type CooperativeUnit } from "@siskop/types";
import { db } from "../src/lib/db.js";
import { createMemberWithPokokSaving, setupTenant } from "./helpers.js";

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
