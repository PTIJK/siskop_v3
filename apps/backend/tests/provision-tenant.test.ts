import { describe, it, expect, afterEach } from "vitest";
import { db } from "../src/lib/db.js";
import { provisionTenant } from "../src/modules/tenants/provision.js";

afterEach(async () => {
  await db.tenant.deleteMany({});
});

describe("provisionTenant", () => {
  it("creates a tenant with exactly one unit", async () => {
    const tenant = await provisionTenant({
      name: "KSP Sejahtera",
      slug: "sejahtera",
      cooperativeId: "KOP-001",
      email: "admin@sejahtera.test",
      phone: "0812",
      address: "Jl. Merdeka 1",
      firstUnit: { type: "KSP", name: "Simpan Pinjam" }
    });

    const units = await db.cooperativeUnit.findMany({ where: { tenantId: tenant.id } });
    expect(units).toHaveLength(1);
    expect(units[0]?.type).toBe("KSP");
  });

  it("creates a multi-unit tenant when more units are supplied", async () => {
    const tenant = await provisionTenant({
      name: "KSU Bersama",
      slug: "bersama",
      cooperativeId: "KOP-002",
      email: "admin@bersama.test",
      phone: "0813",
      address: "Jl. Merdeka 2",
      firstUnit: { type: "KSP", name: "Simpan Pinjam" },
      additionalUnits: [{ type: "KONSUMEN", name: "Waserda" }]
    });

    const units = await db.cooperativeUnit.findMany({ where: { tenantId: tenant.id } });
    expect(units).toHaveLength(2);
  });

  // The regression guard for the invariant: a tenant with zero units must be
  // unreachable, so a failed unit insert has to take the tenant row with it.
  it("leaves no orphan tenant when unit creation fails", async () => {
    await expect(
      provisionTenant({
        name: "Bad Coop",
        slug: "bad-coop",
        cooperativeId: "KOP-003",
        email: "admin@bad.test",
        phone: "0814",
        address: "Jl. Merdeka 3",
        firstUnit: { type: "NOT_A_TYPE" as never, name: "Broken" }
      })
    ).rejects.toThrow();

    const tenants = await db.tenant.findMany({ where: { cooperativeId: "KOP-003" } });
    expect(tenants).toHaveLength(0);
  });
});
