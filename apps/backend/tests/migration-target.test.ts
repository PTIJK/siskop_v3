import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { executeMigration, previewMigration } from "../src/modules/migration/service.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
const rows = (extra: Record<string, Record<string, string | number | null>[]> = {}) => ({
  "1_Koperasi": [KOPERASI],
  "2_Unit": [UNIT],
  "4_Produk_Simpanan": [SIMPANAN_POKOK],
  "6_Produk_Pinjaman": [PINJAMAN],
  "3_Anggota": [ANGGOTA(NIK1, "Siti")],
  "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 100000 }],
  "9_Saldo_Awal_Jurnal": [
    { accountCode: "1-1000", debit: 100000 },
    { accountCode: "3-1000", credit: 100000 }
  ],
  ...extra
});

let actor: { userId: string; requestId: string; ip: null; userAgent: null };
let adminToken: string;
let targetId: string;

/** A koperasi the way registration leaves it: tenant, unit, roles, COA, one Super Admin, nothing else. */
async function registerTarget(overrides: Parameters<typeof setupTenant>[0] = {}) {
  const s = await setupTenant({
    tenantName: "Koperasi Uji",
    slug: "koperasi-uji",
    registrationNo: "AHU-001",
    adminEmail: "admin@koperasi-uji.test",
    ...overrides
  });
  return s.user.tenantId;
}

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  targetId = await registerTarget();
  const session = await createPlatformAdminSession("platform-admin@demo.test");
  actor = { userId: session.user.id, requestId: "r1", ip: null, userAgent: null };
  adminToken = session.accessToken;
});

describe("migration into an existing koperasi", () => {
  it("previews without creating anything and reports the target", async () => {
    const p = await previewMigration(await fixtureWorkbook("SISTEM", rows()), { tenantId: targetId });
    expect(p.canExecute).toBe(true);
    expect(p.target).toMatchObject({ tenantId: targetId, slug: "koperasi-uji", name: "Koperasi Uji" });
    expect(await db.member.count({ where: { tenantId: targetId } })).toBe(0);
  });

  it("loads into the same tenant without a password and without creating a tenant", async () => {
    const before = await withoutTenantScope(() => db.tenant.count());
    const buf = await fixtureWorkbook("SISTEM", rows());
    const p = await previewMigration(buf, { tenantId: targetId });
    const r = await executeMigration(buf, { fileHash: p.fileHash, tenantId: targetId, actor });

    expect(r.tenantId).toBe(targetId);
    expect(await withoutTenantScope(() => db.tenant.count())).toBe(before);
    expect(await db.member.count({ where: { tenantId: targetId } })).toBe(1);
    expect(await db.saving.count({ where: { tenantId: targetId } })).toBe(1);
    const total = await db.journalLine.aggregate({ where: { tenantId: targetId }, _sum: { debit: true, credit: true } });
    expect(total._sum.debit!.toString()).toBe(total._sum.credit!.toString());
    expect(await db.user.count({ where: { tenantId: targetId } })).toBe(1);
    const audit = await db.auditLog.findFirst({ where: { tenantId: targetId, action: "tenant.migrate" } });
    expect(audit?.actorUserId).toBe(actor.userId);
  });

  it("rows are created by the target tenant's own admin", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows());
    await executeMigration(buf, { fileHash: (await previewMigration(buf, { tenantId: targetId })).fileHash, tenantId: targetId, actor });
    const admin = await db.user.findFirstOrThrow({ where: { tenantId: targetId } });
    const txn = await db.savingTransaction.findFirstOrThrow({ where: { tenantId: targetId } });
    expect(txn.createdBy).toBe(admin.id);
  });

  it("refuses a koperasi that already holds data", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows());
    await executeMigration(buf, { fileHash: (await previewMigration(buf, { tenantId: targetId })).fileHash, tenantId: targetId, actor });
    const again = await previewMigration(buf, { tenantId: targetId });
    expect(again.canExecute).toBe(false);
    expect(again.issues.some((i) => i.severity === "error" && /sudah berisi data/.test(i.message))).toBe(true);
  });

  it("refuses a file whose subdomain differs from the chosen koperasi", async () => {
    const other = await fixtureWorkbook("SISTEM", rows({ "1_Koperasi": [{ ...KOPERASI, slug: "koperasi-lain" }] }));
    const p = await previewMigration(other, { tenantId: targetId });
    expect(p.canExecute).toBe(false);
    expect(p.issues.some((i) => i.column === "slug" && /berbeda dari koperasi tujuan/.test(i.message))).toBe(true);
  });

  it("refuses a koperasi with no active admin", async () => {
    await db.user.deleteMany({ where: { tenantId: targetId } });
    const p = await previewMigration(await fixtureWorkbook("SISTEM", rows()), { tenantId: targetId });
    expect(p.canExecute).toBe(false);
    expect(p.issues.some((i) => /belum punya admin/.test(i.message))).toBe(true);
  });

  it("404s an unknown koperasi", async () => {
    await expect(previewMigration(await fixtureWorkbook("SISTEM", rows()), { tenantId: "does-not-exist" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("adds a sheet-2 unit the koperasi lacks and reuses one it has", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows({ "2_Unit": [UNIT, { unitCode: "U2", type: "KONSUMEN", name: "Toko" }] }));
    await executeMigration(buf, { fileHash: (await previewMigration(buf, { tenantId: targetId })).fileHash, tenantId: targetId, actor });
    const units = await db.cooperativeUnit.findMany({ where: { tenantId: targetId } });
    expect(units.map((u) => u.name).sort()).toEqual(["Simpan Pinjam", "Toko"]);
  });

  it("rejects an extra account code the koperasi already has", async () => {
    const extra = { code: "1-1000", name: "Kas Dobel", category: "ASET", normalBalance: "DEBIT" };
    const p = await previewMigration(await fixtureWorkbook("SISTEM", rows({ "10_Akun_Tambahan": [extra] })), { tenantId: targetId });
    expect(p.canExecute).toBe(false);
    expect(p.issues.some((i) => i.sheet === "10_Akun_Tambahan" && i.column === "code")).toBe(true);
  });
});

describe("migration routes with a target koperasi", () => {
  const P = "/api/platform/migration";

  it("previews and executes with tenantId and no admin password", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows());
    const pre = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${adminToken}`).field("tenantId", targetId).attach("file", buf, "m.xlsx");
    expect(pre.status).toBe(200);
    expect(pre.body.data.target.tenantId).toBe(targetId);
    const exec = await request(app())
      .post(`${P}/execute`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("fileHash", pre.body.data.fileHash)
      .field("tenantId", targetId)
      .attach("file", buf, "m.xlsx");
    expect(exec.status).toBe(201);
    expect(exec.body.data.tenantId).toBe(targetId);
  });

  it("still requires an admin password when creating a new koperasi", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows());
    const pre = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${adminToken}`).attach("file", buf, "m.xlsx");
    const exec = await request(app())
      .post(`${P}/execute`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("fileHash", pre.body.data.fileHash)
      .attach("file", buf, "m.xlsx");
    expect(exec.status).toBe(422);
  });
});
