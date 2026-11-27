import { describe, expect, it } from "vitest";
import { isMultiUnit, type CooperativeUnit } from "@siskop/types";

const makeUnit = (id: string, overrides: Partial<CooperativeUnit> = {}): CooperativeUnit => ({
  id,
  tenantId: "t1",
  type: "KSP",
  name: `Unit ${id}`,
  isActive: true,
  isHidden: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

describe("isMultiUnit", () => {
  it("ignores hidden units when checking multi-unit status", () => {
    expect(isMultiUnit([makeUnit("1"), makeUnit("2")])).toBe(true);
    expect(isMultiUnit([makeUnit("1"), makeUnit("2", { isHidden: true })])).toBe(false);
  });
});
