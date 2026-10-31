import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";
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
const P = "/api/platform/migration";
let token: string;
let tenantAdminToken: string;

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  token = (await createPlatformAdminSession()).accessToken;
});

describe("platform migration routes", () => {
  it("requires auth", async () => {
    expect((await request(app()).post(`${P}/preview`)).status).toBe(401);
  });

  it("forbids a tenant admin", async () => {
    await db.tenant.deleteMany({});
    tenantAdminToken = (await setupTenant()).accessToken;
    const res = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${tenantAdminToken}`);
    expect(res.status).toBe(403);
  });

  it("serves both templates and 404s an unknown mode", async () => {
    for (const mode of ["sistem", "laporan"]) {
      const res = await request(app())
        .get(`${P}/templates/${mode}`)
        .set("Authorization", `Bearer ${token}`)
        .buffer()
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (d: Buffer) => chunks.push(d));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("spreadsheetml");
    }
    expect((await request(app()).get(`${P}/templates/xx`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
  });

  it("previews then executes, returning the ApiResponse envelope", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    const pre = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`).attach("file", buf, "migrasi.xlsx");
    expect(pre.status).toBe(200);
    expect(pre.body.success).toBe(true);
    expect(pre.body.data.canExecute).toBe(true);
    const exec = await request(app())
      .post(`${P}/execute`)
      .set("Authorization", `Bearer ${token}`)
      .field("fileHash", pre.body.data.fileHash)
      .field("adminPassword", "Rahasia123")
      .attach("file", buf, "migrasi.xlsx");
    expect(exec.status).toBe(201);
    expect(exec.body.data.slug).toBe("koperasi-uji");
  });

  it("rejects a non-xlsx upload and a missing file", async () => {
    const bad = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`).attach("file", Buffer.from("hello"), "x.xlsx");
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("MIGRATION_FILE_INVALID");
    expect((await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`)).status).toBe(422);
  });

  it("rejects a file over 10 MB with the error envelope, not a 500", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x50);
    const res = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`).attach("file", big, "big.xlsx");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("MIGRATION_FILE_INVALID");
  });

  it("never echoes the admin password", async () => {
    const buf = await fixtureWorkbook("SISTEM", rows);
    const pre = await request(app()).post(`${P}/preview`).set("Authorization", `Bearer ${token}`).attach("file", buf, "m.xlsx");
    const exec = await request(app())
      .post(`${P}/execute`)
      .set("Authorization", `Bearer ${token}`)
      .field("fileHash", pre.body.data.fileHash)
      .field("adminPassword", "Rahasia123")
      .attach("file", buf, "m.xlsx");
    expect(JSON.stringify(exec.body)).not.toContain("Rahasia123");
  });
});
