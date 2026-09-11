import { describe, it, expect, afterEach } from "vitest";
import { db } from "../src/lib/db.js";
import { provisionTenant } from "../src/modules/tenants/provision.js";

afterEach(async () => {
  await db.tenant.deleteMany({});
});

describe("provisionTenant", () => {
  it("creates a tenant with exactly one unit", async () => {
    const { tenant } = await provisionTenant({
      name: "KSP Sejahtera",
      slug: "sejahtera",
      registrationNo: "KOP-001",
      address: "Jl. Merdeka 1",
      type: "KONVENSIONAL",
      firstUnit: { type: "KSP", name: "Simpan Pinjam" }
    });

    const units = await db.cooperativeUnit.findMany({ where: { tenantId: tenant.id } });
    expect(units).toHaveLength(1);
    expect(units[0]?.type).toBe("KSP");
  });

  it("creates a multi-unit tenant when more units are supplied", async () => {
    const { tenant } = await provisionTenant({
      name: "KSU Bersama",
      slug: "bersama",
      registrationNo: "KOP-002",
      address: "Jl. Merdeka 2",
      type: "KONVENSIONAL",
      firstUnit: { type: "KSP", name: "Simpan Pinjam" },
      additionalUnits: [{ type: "KONSUMEN", name: "Waserda" }]
    });

    const units = await db.cooperativeUnit.findMany({ where: { tenantId: tenant.id } });
    expect(units).toHaveLength(2);
  });

  it("seeds the 5 standard roles (Super Admin/Manager/Teller/Viewer/Kasir) for every tenant", async () => {
    const { tenant, roles } = await provisionTenant({
      name: "KSP Sejahtera",
      slug: "sejahtera",
      registrationNo: "KOP-001",
      address: "Jl. Merdeka 1",
      type: "KONVENSIONAL",
      firstUnit: { type: "KSP", name: "Simpan Pinjam" }
    });

    expect(roles.map((r) => r.name).sort()).toEqual(["Kasir", "Manager", "Super Admin", "Teller", "Viewer"]);
    expect(roles.every((r) => r.tenantId === tenant.id)).toBe(true);

    const superAdmin = roles.find((r) => r.name === "Super Admin");
    expect(superAdmin?.permissions).toMatchObject({
      members: { create: true, read: true, update: true, delete: true }
    });

    const teller = roles.find((r) => r.name === "Teller");
    expect(teller?.permissions).toMatchObject({
      members: { read: true },
      savings: { create: true, read: true, update: true, delete: false }
    });
  });

  // Kasir is the Toko-only role: konsumen (Toko/POS) access and nothing else
  // — no members/savings/loans/reports/config/users/roles/accounting, so a
  // Kasir account cannot reach any other unit's financial data even if it
  // somehow had unit access to it (defense in depth alongside unit scoping).
  it("seeds a Toko-only Kasir role", async () => {
    const { roles } = await provisionTenant({
      name: "KSP Sejahtera",
      slug: "sejahtera-kasir",
      registrationNo: "KOP-004",
      address: "Jl. Merdeka 1",
      type: "KONVENSIONAL",
      firstUnit: { type: "KSP", name: "Simpan Pinjam" }
    });

    const kasir = roles.find((r) => r.name === "Kasir");
    expect(kasir?.permissions).toMatchObject({
      konsumen: { create: true, read: true, update: true },
      members: {},
      savings: {},
      loans: {},
      reports: {},
      config: {},
      users: {},
      roles: {}
    });
  });

  // The regression guard for the invariant: a tenant with zero units must be
  // unreachable, so a failed unit insert has to take the tenant row with it.
  it("leaves no orphan tenant when unit creation fails", async () => {
    await expect(
      provisionTenant({
        name: "Bad Coop",
        slug: "bad-coop",
        registrationNo: "KOP-003",
        address: "Jl. Merdeka 3",
        type: "KONVENSIONAL",
        firstUnit: { type: "NOT_A_TYPE" as never, name: "Broken" }
      })
    ).rejects.toThrow();

    const tenants = await db.tenant.findMany({ where: { registrationNo: "KOP-003" } });
    expect(tenants).toHaveLength(0);
  });
});
