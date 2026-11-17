import ExcelJS from "exceljs";
import { KOPKAR_RAT_TENANT_ID } from "@siskop/types";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { signAccessToken, verifyAccessToken } from "../src/middleware/auth.js";
import { login } from "../src/modules/auth/service.js";
import { testDatabaseUrl } from "./database-isolation.js";
import { app, createPlatformAdminSession, createStaffSession, setupTenant } from "./helpers.js";

const path = "/api/platform/migration/kopkar-rat";
const savingsSheet = "5_Saldo_Simpanan";
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

async function removeArchiveFixture() {
  testDatabaseUrl(process.env.DATABASE_URL ?? "");
  await db.$executeRaw`DROP TABLE IF EXISTS public."KopkarRatSourceArchive"`;
}

beforeEach(removeArchiveFixture);
afterAll(removeArchiveFixture);

it("requires platform admin and handles a database without the archive", async () => {
  expect((await request(app()).get(path)).status).toBe(401);
  expect((await request(app()).get(path).set("Authorization", `Bearer ${staff}`)).status).toBe(403);
  const empty = await request(app()).get(path).set("Authorization", `Bearer ${admin}`);
  expect(empty.status).toBe(200);
  expect(empty.body.data).toEqual({ files: [], sheet: null });
});

async function installArchiveFixture() {
  const wb = new ExcelJS.Workbook();
  const members = wb.addWorksheet("3_Anggota");
  members.getRow(1).values = ["legacyNo", "fullName", "nik"];
  members.getRow(4).values = [undefined, "Sumber Uji", "TMP-0001"];
  members.getRow(5).values = [17, "Sumber Kedua", "SRC-0001"];
  const savings = wb.addWorksheet(savingsSheet);
  savings.getRow(1).values = ["nik", "balance"];
  savings.getRow(4).values = ["TMP-0001", -13000000];
  savings.getCell("C4").value = { formula: "B4*2", result: -26000000 };
  const notes = JSON.stringify([{ sheet: savingsSheet, row: 4, note: "Periksa saldo negatif" }]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  await db.$executeRaw`CREATE TABLE public."KopkarRatSourceArchive" (tenant_id text, source_kind text, file_name text, sheet_count int, workbook bytea, review_notes jsonb)`;
  for (const tenant of ["cmvpy390900018h9b1zq0c87x", "another-tenant"]) {
    await db.$executeRaw`INSERT INTO public."KopkarRatSourceArchive" VALUES (${tenant}, 'prepared_review', ${tenant === "another-tenant" ? "other.xlsx" : "review.xlsx"}, 2, ${bytes}, ${notes}::jsonb)`;
  }
  return bytes;
}

it("shows archived XLSX rows and flags without accepting another tenant or posting records", async () => {
  await installArchiveFixture();
  const read = () => request(app()).get(path).set("Authorization", `Bearer ${admin}`);
  const liveCount = await db.member.count({ where: { tenantId: "cmvpy390900018h9b1zq0c87x" } });
  const response = await read();
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.body.data.files).toEqual([{ kind: "prepared_review", name: "review.xlsx", sheetCount: 2 }]);
  expect(response.body.data.sheet.rows[1]).toMatchObject({ row: 4, flags: ["missing_nik"] });
  const finance = await read().query({ sheet: savingsSheet });
  expect(finance.status).toBe(200);
  expect(finance.body.data.sheet.rows[1]).toMatchObject({ row: 4, cells: ["TMP-0001", "-13000000", "=B4*2 → -26000000"], flags: ["unverified_balance"], notes: ["Periksa saldo negatif"] });
  expect((await read().query({ tenantId: "another-tenant" })).status).toBe(422);
  expect((await read().query({ sheet: "missing" })).status).toBe(404);
  expect((await read().query({ page: 0 })).status).toBe(422);
  expect(await db.member.count({ where: { tenantId: "cmvpy390900018h9b1zq0c87x" } })).toBe(liveCount);
});

it("shows only provisional identity rows to Kopkar staff with members.read", async () => {
  await installArchiveFixture();
  const provisional = "/api/members/provisional-rat";
  const claims = verifyAccessToken(staff, "test-secret");
  const kopkar = { ...claims, tenantId: KOPKAR_RAT_TENANT_ID };
  const token = signAccessToken(kopkar, "test-secret", "15m");
  const denied = signAccessToken({ ...kopkar, permissions: { ...kopkar.permissions, members: {} } }, "test-secret", "15m");
  const read = (accessToken: string) => request(app()).get(provisional).set("Authorization", `Bearer ${accessToken}`);
  expect((await request(app()).get(provisional)).status).toBe(401);
  expect((await read(staff)).status).toBe(403);
  expect((await read(denied)).status).toBe(403);
  expect((await read(token).query({ sheet: "5_Saldo_Simpanan" })).status).toBe(422);
  const response = await read(token);
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.body.data).toEqual([
    { temporaryId: "TMP-0001", fullName: "Sumber Uji", legacyNo: null, sourceRow: 4,
      nik: null, address: null, birthPlace: null, birthDate: null, occupation: null },
    { temporaryId: "TMP-SRC-0001", fullName: "Sumber Kedua", legacyNo: "17", sourceRow: 5,
      nik: null, address: null, birthPlace: null, birthDate: null, occupation: null }
  ]);
  const live = await request(app()).get("/api/members").set("Authorization", `Bearer ${token}`);
  expect(live.status).toBe(200);
  expect(live.body.data).toEqual([]);
});

it("lets only the active Kopkar Super Admin review and download the source archive", async () => {
  const bytes = await installArchiveFixture();
  const slug = "kopkar-rat-client-test";
  const email = "kopkar-rat-client@test.example";
  const tenant = await setupTenant({ slug, registrationNo: "kopkar-rat-client-test", adminEmail: email });
  await db.tenant.update({ where: { id: tenant.user.tenantId }, data: { id: KOPKAR_RAT_TENANT_ID } });
  const client = await login(slug, email, "rahasia123");
  const manager = await createStaffSession(KOPKAR_RAT_TENANT_ID, slug, "Manager", "kopkar-manager@test.example");
  const path = "/api/reports/arsip-rat";
  const auth = (token: string) => "Bearer " + token;
  const page = () => request(app()).get(path).set("Authorization", auth(client.accessToken));
  const download = (token: string) => request(app()).get(path + "/file").set("Authorization", auth(token));

  expect((await request(app()).get(path)).status).toBe(401);
  for (const token of [staff, manager.accessToken]) {
    expect((await request(app()).get(path).set("Authorization", auth(token))).status).toBe(403);
    expect((await download(token)).status).toBe(403);
  }
  const response = await page().query({ sheet: savingsSheet });
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.body.data.sheet.rows[1]).toMatchObject({
    row: 4, cells: ["TMP-0001", "-13000000", "=B4*2 → -26000000"],
    flags: ["unverified_balance"], notes: ["Periksa saldo negatif"]
  });
  expect((await page().query({ tenantId: "another-tenant" })).status).toBe(422);
  const file = await download(client.accessToken).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  expect(file.status).toBe(200);
  expect(file.headers["content-disposition"]).toContain("attachment");
  expect(file.headers["cache-control"]).toContain("no-store");
  expect(file.body).toEqual(bytes);
  await db.user.update({ where: { id: client.user.id, tenantId: KOPKAR_RAT_TENANT_ID }, data: { isActive: false } });
  expect((await page()).status).toBe(403);
});
