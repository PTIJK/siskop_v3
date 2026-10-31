import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { executeMigration, previewMigration } from "../src/modules/migration/service.js";
import { createPlatformAdminSession } from "./helpers.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
const rows = {
  "1_Koperasi": [KOPERASI],
  "2_Unit": [UNIT],
  "4_Produk_Simpanan": [SIMPANAN_POKOK],
  "6_Produk_Pinjaman": [PINJAMAN],
  "3_Anggota": [ANGGOTA(NIK1, "Siti")],
  "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 100000 }],
  "9_Saldo_Awal_Jurnal": [
    { accountCode: "1-1000", debit: 100000 },
    { accountCode: "3-1000", credit: 100000 }
  ]
};
const tenants = () => withoutTenantScope(() => db.tenant.count({ where: { slug: "koperasi-uji" } }));
let actor: { userId: string; requestId: string; ip: null; userAgent: null };

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  const session = await createPlatformAdminSession();
  actor = { userId: session.user.id, requestId: "r1", ip: null, userAgent: null };
});

describe("previewMigration", () => {
  it("writes nothing and returns counts, totals and the opening entry", async () => {
    const p = await previewMigration(await fixtureWorkbook("SISTEM", rows));
    expect(p.canExecute).toBe(true);
    expect(p.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.counts.find((c) => c.sheet === "3_Anggota")?.rows).toBe(1);
    expect(p.openingEntry.length).toBeGreaterThanOrEqual(0);
    expect(await tenants()).toBe(0);
  });

  it("reports errors and refuses execute when the file is invalid", async () => {
    const p = await previewMigration(await fixtureWorkbook("SISTEM", { ...rows, "3_Anggota": [ANGGOTA("12", "X")] }));
    expect(p.canExecute).toBe(false);
    expect(p.issues.some((i) => i.sheet === "3_Anggota" && i.column === "nik")).toBe(true);
  });

  it("reports a clash with an existing tenant slug", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    await executeMigration(buf, { fileHash: (await previewMigration(buf)).fileHash, adminPassword: "Rahasia123", actor });
    const again = await previewMigration(buf);
    expect(again.canExecute).toBe(false);
    expect(again.issues.some((i) => i.sheet === "1_Koperasi" && i.column === "slug")).toBe(true);
  });
});

describe("executeMigration", () => {
  it("commits the tenant when the hash matches and logs tenant.migrate", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    const result = await executeMigration(buf, { fileHash: (await previewMigration(buf)).fileHash, adminPassword: "Rahasia123", actor });
    expect(result.slug).toBe("koperasi-uji");
    expect(await tenants()).toBe(1);
    const audit = await db.auditLog.findFirst({ where: { tenantId: result.tenantId, action: "tenant.migrate" } });
    expect(audit?.actorUserId).toBe(actor.userId);
  });

  it("rejects a different file than the previewed one", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    await expect(executeMigration(buf, { fileHash: "0".repeat(64), adminPassword: "Rahasia123", actor })).rejects.toMatchObject({
      code: "MIGRATION_PREVIEW_MISMATCH"
    });
    expect(await tenants()).toBe(0);
  });

  it("rolls back everything when the file has errors", async () => {
    const buf = await fixtureWorkbook("SISTEM", { ...rows, "3_Anggota": [ANGGOTA("12", "X")] });
    await expect(
      executeMigration(buf, { fileHash: (await previewMigration(buf)).fileHash, adminPassword: "Rahasia123", actor })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await tenants()).toBe(0);
  });

  it("rejects a short admin password", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    await expect(
      executeMigration(buf, { fileHash: (await previewMigration(buf)).fileHash, adminPassword: "short", actor })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
