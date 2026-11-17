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

async function installArchiveFixture(includeLoans = false) {
  const wb = new ExcelJS.Workbook();
  const members = wb.addWorksheet("3_Anggota");
  members.getRow(1).values = ["legacyNo", "fullName", "nik"];
  members.getRow(4).values = [undefined, "Sumber Uji", "TMP-0001"];
  members.getRow(5).values = [17, "Sumber Kedua", "SRC-0001"];
  const savings = wb.addWorksheet(savingsSheet);
  savings.getRow(1).values = ["nik", "balance"];
  savings.getRow(4).values = ["TMP-0001", -13000000];
  savings.getCell("C4").value = { formula: "B4*2", result: -26000000 };
  if (includeLoans) {
    const loans = wb.addWorksheet("7_Pinjaman");
    loans.getRow(1).values = ["loanRef", "nik", "remainingPrincipal"];
    loans.getRow(4).values = ["PB-UJI", "TMP-0001", 600000];
  }
  const notes = JSON.stringify([{ sheet: savingsSheet, row: 4, note: "Periksa saldo negatif" }]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  await db.$executeRaw`CREATE TABLE public."KopkarRatSourceArchive" (tenant_id text, source_kind text, file_name text, sheet_count int, workbook bytea, review_notes jsonb)`;
  for (const tenant of ["cmvpy390900018h9b1zq0c87x", "another-tenant"]) {
    await db.$executeRaw`INSERT INTO public."KopkarRatSourceArchive" VALUES (${tenant}, 'prepared_review', ${tenant === "another-tenant" ? "other.xlsx" : "review.xlsx"}, ${wb.worksheets.length}, ${bytes}, ${notes}::jsonb)`;
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

it("publishes verified Kopkar batches atomically, with no cash movement or duplicate posting", async () => {
  await installArchiveFixture(true);
  const tenantId = KOPKAR_RAT_TENANT_ID;
  await db.tenant.deleteMany({ where: { id: tenantId } });
  const slug = "kopkar-publish-test";
  const email = "kopkar-publish@test.example";
  const original = await setupTenant({ slug, registrationNo: "kopkar-publish-test", adminEmail: email });
  await db.tenant.update({ where: { id: original.user.tenantId }, data: { id: tenantId } });
  const session = await login(slug, email, "rahasia123");
  const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId, type: "KSP" } });
  const base = "/api/reports/arsip-rat/publish";
  const post = (body: Record<string, unknown>, review = false, token = session.accessToken) =>
    request(app()).post(base + (review ? "/preview" : "")).set("Authorization", "Bearer " + token).send(body);
  const member = {
    kind: "member", unitId: unit.id, rows: [{ sourceRow: 4, action: "create", identity: {
      fullName: "Sumber Uji", nik: "3578000000000001", address: "Jalan Uji, Surabaya", birthPlace: "Surabaya",
      birthDate: "1990-01-02", occupation: "Pegawai"
    } }]
  };
  expect((await post(member, true, staff)).status).toBe(403);
  const memberOptions = await request(app()).get(base).query({ kind: "member" }).set("Authorization", "Bearer " + session.accessToken);
  expect(memberOptions.body.data.rows).toEqual([expect.objectContaining({ sourceRow: 4, published: false }), expect.objectContaining({ sourceRow: 5, published: false })]);
  const memberPreview = await post(member, true);
  expect(memberPreview.status).toBe(200);
  const token = memberPreview.body.data.token;
  expect(await db.member.count({ where: { tenantId } })).toBe(0);
  expect((await post({ batch: member, token, confirmed: false })).status).toBe(422);
  expect((await post({ batch: { ...member, unitId: "other" }, token, confirmed: true })).status).toBe(409);
  const postedMember = await post({ batch: member, token, confirmed: true });
  expect(postedMember.status).toBe(200);
  expect(postedMember.body.data.alreadyPublished).toBe(false);
  expect((await post({ batch: member, token, confirmed: true })).body.data.alreadyPublished).toBe(true);
  const active = await db.member.findFirstOrThrow({ where: { tenantId, isActive: true } });
  expect(await db.member.count({ where: { tenantId } })).toBe(1);
  expect((await post(member, true)).status).toBe(409);
  const stillProvisional = await request(app()).get("/api/members/provisional-rat").set("Authorization", "Bearer " + session.accessToken);
  expect(stillProvisional.body.data.map((row: { sourceRow: number }) => row.sourceRow)).toEqual([5]);

  const offset = await db.account.create({ data: { tenantId, code: "3-9800", name: "Penampung Uji", category: "EKUITAS", normalBalance: "KREDIT" } });
  const credit = await db.account.create({ data: { tenantId, code: "2-9800", name: "Simpanan Uji", category: "KEWAJIBAN", normalBalance: "KREDIT" } });
  const receivable = await db.account.create({ data: { tenantId, code: "1-9800", name: "Piutang Uji", category: "ASET", normalBalance: "DEBIT" } });
  const cash = await db.account.create({ data: { tenantId, code: "1-9801", name: "Kas Uji", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true } });
  const product = await db.savingConfig.create({ data: { tenantId, name: "Simpanan Uji", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "TAHUN" } });
  const loanProduct = await db.loanConfig.create({ data: { tenantId, name: "Pinjaman Uji", type: "KONVENSIONAL", rateType: "BUNGA", rate: 1, maxTermMonths: 12 } });
  const opening = { unitId: unit.id, cutoffDate: "2025-12-31", offsetAccountId: offset.id, verificationRef: "REKONSILIASI-UJI-001" };
  const saving = { kind: "saving", ...opening, rows: [{ sourceRow: 4, productId: product.id, balance: "150000.25" }] };
  expect((await post(saving, true)).status).toBe(422);
  expect(await db.saving.count({ where: { tenantId } })).toBe(0);

  await db.accountMapping.createMany({ data: [
    { tenantId, sourceType: "SAVING_CONFIG", sourceId: product.id, transactionKind: "DEPOSIT", debitAccountId: cash.id, creditAccountId: credit.id },
    { tenantId, sourceType: "LOAN_CONFIG", sourceId: loanProduct.id, transactionKind: "DISBURSEMENT", debitAccountId: receivable.id, creditAccountId: cash.id },
    { tenantId, sourceType: "LOAN_CONFIG", sourceId: loanProduct.id, transactionKind: "PAYMENT_PRINCIPAL", debitAccountId: cash.id, creditAccountId: receivable.id },
    { tenantId, sourceType: "LOAN_CONFIG", sourceId: loanProduct.id, transactionKind: "PAYMENT_INTEREST", debitAccountId: cash.id, creditAccountId: offset.id }
  ] });
  const savingPreview = await post(saving, true);
  expect(savingPreview.status).toBe(200);
  expect(savingPreview.body.data.rows[0].journal).toMatchObject({ debit: "3-9800 · Penampung Uji", credit: "2-9800 · Simpanan Uji", amount: "150000.25" });
  expect(await db.journalLine.count({ where: { tenantId } })).toBe(0);
  await db.account.update({ where: { tenantId, id: offset.id }, data: { name: "Penampung Berubah" } });
  expect((await post({ batch: saving, token: savingPreview.body.data.token, confirmed: true })).status).toBe(409);
  expect(await db.saving.count({ where: { tenantId } })).toBe(0);
  await db.account.update({ where: { tenantId, id: offset.id }, data: { name: "Penampung Uji" } });
  const postedSaving = await post({ batch: saving, token: savingPreview.body.data.token, confirmed: true });
  expect(postedSaving.status).toBe(200);

  const item = { sourceRow: 4, productId: loanProduct.id, contractRef: "ASLI-01", disbursedAt: "2025-11-01",
    principalAmount: "1200000", totalAmount: "1260000", remainingPrincipal: "600000", remainingAmount: "630000",
    termMonths: 6, rate: "1", installmentAmount: "210000",
    schedule: [1, 2, 3].map((month) => ({ dueDate: "2026-0" + month + "-01", principal: "200000", margin: "10000" })) };
  const loan = { kind: "loan", ...opening, rows: [item] };
  expect((await post({ ...loan, rows: [{ ...item, schedule: item.schedule.slice(0, 1) }] }, true)).status).toBe(422);
  const loanPreview = await post(loan, true);
  expect(loanPreview.status).toBe(200);
  expect(loanPreview.body.data.rows[0].journal).toMatchObject({ debit: "1-9800 · Piutang Uji", credit: "3-9800 · Penampung Uji", amount: "600000.00" });
  const postedLoan = await post({ batch: loan, token: loanPreview.body.data.token, confirmed: true });
  expect(postedLoan.status).toBe(200);

  expect((await db.saving.findFirstOrThrow({ where: { tenantId, memberId: active.id } })).balance.toString()).toBe("150000.25");
  expect((await db.loan.findFirstOrThrow({ where:{ tenantId, memberId: active.id } })).remainingAmount.toString()).toBe("630000");
  expect(await db.loanInstallment.count({ where: { tenantId } })).toBe(3);
  expect(await db.loanPayment.count({ where: { tenantId } })).toBe(0);
  expect(await db.journalLine.count({ where: { tenantId, accountId: cash.id } })).toBe(0);
  expect(await db.journalLine.count({ where: { tenantId } })).toBe(4);
  expect(await db.kopkarRatPublication.count({ where: { tenantId } })).toBe(3);
  expect(await db.kopkarRatPublication.count({ where: { tenantId, verificationRef: opening.verificationRef } })).toBe(2);
});
