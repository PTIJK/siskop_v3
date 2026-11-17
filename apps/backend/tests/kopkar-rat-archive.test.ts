import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { testDatabaseUrl } from "./database-isolation.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";

const path = "/api/platform/migration/kopkar-rat";
let admin: string;
let staff: string;

beforeAll(async () => {
  testDatabaseUrl(process.env.DATABASE_URL ?? "");
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  admin = (await createPlatformAdminSession()).accessToken;
  staff = (await setupTenant({ slug: "rat-archive-staff-test", registrationNo: "rat-archive-staff-test", adminEmail: "rat-archive-staff@test.example" })).accessToken;
});

afterAll(async () => {
  testDatabaseUrl(process.env.DATABASE_URL ?? "");
  await db.$executeRaw`DROP TABLE IF EXISTS public."KopkarRatSourceArchive"`;
});

it("requires platform admin and handles a database without the archive", async () => {
  expect((await request(app()).get(path)).status).toBe(401);
  expect((await request(app()).get(path).set("Authorization", `Bearer ${staff}`)).status).toBe(403);
  const empty = await request(app()).get(path).set("Authorization", `Bearer ${admin}`);
  expect(empty.status).toBe(200);
  expect(empty.body.data).toEqual({ files: [], sheet: null });
});

it("shows archived XLSX rows and flags without accepting another tenant or posting records", async () => {
  const wb = new ExcelJS.Workbook();
  const members = wb.addWorksheet("3_Anggota");
  members.getRow(1).values = ["legacyNo", "fullName", "nik"];
  members.getRow(4).values = [undefined, "Sumber Uji", "TMP-0001"];
  const savings = wb.addWorksheet("5_Saldo_Simpanan");
  savings.getRow(1).values = ["nik", "balance"];
  savings.getRow(4).values = ["TMP-0001", -13000000];
  savings.getCell("C4").value = { formula: "B4*2", result: -26000000 };
  const notes = JSON.stringify([{ sheet: savings.name, row: 4, note: "Periksa saldo negatif" }]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  await db.$executeRaw`CREATE TABLE public."KopkarRatSourceArchive" (tenant_id text, source_kind text, file_name text, sheet_count int, workbook bytea, review_notes jsonb)`;
  for (const tenant of ["cmvpy390900018h9b1zq0c87x", "another-tenant"]) {
    await db.$executeRaw`INSERT INTO public."KopkarRatSourceArchive" VALUES (${tenant}, 'prepared_review', ${tenant === "another-tenant" ? "other.xlsx" : "review.xlsx"}, 2, ${bytes}, ${notes}::jsonb)`;
  }
  const read = () => request(app()).get(path).set("Authorization", `Bearer ${admin}`);
  const liveCount = await db.member.count({ where: { tenantId: "cmvpy390900018h9b1zq0c87x" } });
  const response = await read();
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.body.data.files).toEqual([{ kind: "prepared_review", name: "review.xlsx", sheetCount: 2 }]);
  expect(response.body.data.sheet.rows[1]).toMatchObject({ row: 4, flags: ["missing_nik"] });
  const finance = await read().query({ sheet: savings.name });
  expect(finance.status).toBe(200);
  expect(finance.body.data.sheet.rows[1]).toMatchObject({ row: 4, cells: ["TMP-0001", "-13000000", "=B4*2 → -26000000"], flags: ["unverified_balance"], notes: ["Periksa saldo negatif"] });
  expect((await read().query({ tenantId: "another-tenant" })).status).toBe(422);
  expect((await read().query({ sheet: "missing" })).status).toBe(404);
  expect((await read().query({ page: 0 })).status).toBe(422);
  expect(await db.member.count({ where: { tenantId: "cmvpy390900018h9b1zq0c87x" } })).toBe(liveCount);
});
