import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, setupTenant } from "./helpers.js";
import { createProduct, recordStockMovement } from "../src/modules/konsumen/product.service.js";
import { createSale } from "../src/modules/konsumen/sale.service.js";

/**
 * Day 3 KSU spike: a read-only consolidation service that reports total ASET
 * (asset) balances per CooperativeUnit plus a tenant-wide sum, derived from
 * real JournalEntry/JournalLine rows the real loan-disbursement flow already
 * writes (lib/journal.ts#postLoanDisbursement) — nothing here fabricates
 * journal rows directly.
 *
 * JournalEntry carries no unitId of its own; a LOAN_DISBURSEMENT entry's
 * `sourceId` is the Loan's own id (see journal.ts), so a unit's disbursement
 * entries are found by tracing that unit's Loan ids back through sourceId.
 *
 * The credit side of the DISBURSEMENT mapping below is deliberately an
 * EKUITAS account (not Kas/ASET, unlike prisma/seed.ts's demo mapping) so
 * each loan's net ASET contribution is exactly its principal — isolating the
 * consolidation/grouping logic under test from the (separate, real) question
 * of whether Kas is pooled or segregated per unit, which is out of scope for
 * this spike.
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const KUR_MIKRO = {
  name: "KUR Mikro",
  type: "KONVENSIONAL" as const,
  rateType: "BUNGA" as const,
  rate: 12,
  maxTermMonths: 36
};

async function createSecondUnit(accessToken: string, name = "Simpan Pinjam Unit B") {
  const res = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type: "KSP", name });
  return res.body.data as { id: string; name: string };
}

async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type, name });
  return res.body.data as { id: string; name: string };
}

async function createAccount(
  accessToken: string,
  data: { code: string; name: string; category: string; normalBalance: string }
) {
  const res = await request(app())
    .post("/api/config/accounts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(data);
  return res.body.data as { id: string };
}

async function createAccountMapping(
  accessToken: string,
  data: {
    sourceType: string;
    sourceId: string;
    transactionKind: string;
    debitAccountId: string;
    creditAccountId: string;
  }
) {
  const res = await request(app())
    .post("/api/config/account-mappings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(data);
  return res.body.data;
}

async function createLoanConfigAs(accessToken: string) {
  const res = await request(app())
    .post("/api/loans/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(KUR_MIKRO);
  return res.body.data as { id: string };
}

async function disburseLoan(
  accessToken: string,
  data: { memberId: string; loanConfigId: string; principalAmount: number; unitId?: string }
) {
  return request(app())
    .post("/api/loans")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ termMonths: 12, ...data });
}

/**
 * Wires up tenant-wide SYSTEM/SALE_REVENUE (Kas/Penjualan) + SYSTEM/SALE_COGS
 * (HPP/Persediaan) mappings — same accounts/codes as
 * tests/konsumen-sale.test.ts#setupSaleMappings, duplicated here rather than
 * imported since that helper is module-private to that file.
 */
async function setupSaleMappings(accessToken: string) {
  const kas = await createAccount(accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
  const penjualan = await createAccount(accessToken, {
    code: "4-1000",
    name: "Penjualan",
    category: "PENDAPATAN",
    normalBalance: "KREDIT"
  });
  const hpp = await createAccount(accessToken, { code: "5-1000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
  const persediaan = await createAccount(accessToken, {
    code: "1-1300",
    name: "Persediaan Barang Dagang",
    category: "ASET",
    normalBalance: "DEBIT"
  });

  await request(app())
    .post("/api/config/account-mappings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ sourceType: "SYSTEM", transactionKind: "SALE_REVENUE", debitAccountId: kas.id, creditAccountId: penjualan.id });
  await request(app())
    .post("/api/config/account-mappings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ sourceType: "SYSTEM", transactionKind: "SALE_COGS", debitAccountId: hpp.id, creditAccountId: persediaan.id });

  return { kas, penjualan, hpp, persediaan };
}

/** Wires up one LOAN_CONFIG/DISBURSEMENT mapping: debit an ASET receivable, credit a non-ASET account. */
async function setupDisbursementMapping(accessToken: string, loanConfigId: string) {
  const piutang = await createAccount(accessToken, {
    code: "1-1100",
    name: "Piutang Pinjaman Anggota",
    category: "ASET",
    normalBalance: "DEBIT"
  });
  const modal = await createAccount(accessToken, {
    code: "3-1000",
    name: "Modal Kerja",
    category: "EKUITAS",
    normalBalance: "KREDIT"
  });
  await createAccountMapping(accessToken, {
    sourceType: "LOAN_CONFIG",
    sourceId: loanConfigId,
    transactionKind: "DISBURSEMENT",
    debitAccountId: piutang.id,
    creditAccountId: modal.id
  });
  return { piutang, modal };
}

describe("GET /api/ksu/consolidated", () => {
  it("returns per-unit ASET totals matching each unit's disbursed loan principal, plus a tenant-wide total", async () => {
    const admin = await setupTenant();
    const unitA = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const unitB = await createSecondUnit(admin.accessToken);

    const loanConfig = await createLoanConfigAs(admin.accessToken);
    await setupDisbursementMapping(admin.accessToken, loanConfig.id);

    const memberA = await createMemberWithPokokSaving(admin.accessToken, { nik: "1111111111110001" });
    const memberB = await createMemberWithPokokSaving(admin.accessToken, { nik: "1111111111110002" });

    const loanAResult = await disburseLoan(admin.accessToken, {
      memberId: memberA.id,
      loanConfigId: loanConfig.id,
      principalAmount: 5_000_000
      // no unitId -> resolves to the tenant's default unit (unitA)
    });
    const loanBResult = await disburseLoan(admin.accessToken, {
      memberId: memberB.id,
      loanConfigId: loanConfig.id,
      principalAmount: 8_000_000,
      unitId: unitB.id
    });
    expect(loanAResult.status).toBe(201);
    expect(loanBResult.status).toBe(201);

    const res = await request(app())
      .get("/api/ksu/consolidated")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalAssets).toBe(13_000_000);
    expect(res.body.data.byUnit).toHaveLength(2);

    const unitATotal = res.body.data.byUnit.find((u: { unitId: string }) => u.unitId === unitA.id);
    const unitBTotal = res.body.data.byUnit.find((u: { unitId: string }) => u.unitId === unitB.id);
    expect(unitATotal?.assets).toBe(5_000_000);
    expect(unitATotal?.unitName).toBe(unitA.name);
    expect(unitBTotal?.assets).toBe(8_000_000);
    expect(unitBTotal?.unitName).toBe(unitB.name);
  });

  it("ignores a tenantId query param override and only reports the caller's own tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });

    const loanConfigB = await createLoanConfigAs(tenantB.accessToken);
    await setupDisbursementMapping(tenantB.accessToken, loanConfigB.id);
    const memberB = await createMemberWithPokokSaving(tenantB.accessToken);
    const disburseB = await disburseLoan(tenantB.accessToken, {
      memberId: memberB.id,
      loanConfigId: loanConfigB.id,
      principalAmount: 9_000_000
    });
    expect(disburseB.status).toBe(201);

    const res = await request(app())
      .get(`/api/ksu/consolidated?tenantId=${tenantB.user.tenantId}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(200);
    // Tenant A has its own (unmapped, unfunded) default unit only — tenant B's
    // 9,000,000 disbursement must never leak in via the query param.
    expect(res.body.data.totalAssets).toBe(0);
    expect(res.body.data.byUnit).toHaveLength(1);
  });

  it("includes a KONSUMEN unit's POS sale (Kas up, Persediaan down) alongside a KSP unit's loan principal", async () => {
    const admin = await setupTenant();
    const unitKsp = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    // KSP side: same disbursement pattern as the first test in this file —
    // debit an ASET receivable, credit a non-ASET (EKUITAS) account, so the
    // unit's net ASET contribution is exactly its principal.
    const loanConfig = await createLoanConfigAs(admin.accessToken);
    await setupDisbursementMapping(admin.accessToken, loanConfig.id);
    const memberA = await createMemberWithPokokSaving(admin.accessToken, { nik: "1111111111119001" });
    const loanResult = await disburseLoan(admin.accessToken, {
      memberId: memberA.id,
      loanConfigId: loanConfig.id,
      principalAmount: 5_000_000
      // no unitId -> resolves to the tenant's default (KSP) unit
    });
    expect(loanResult.status).toBe(201);

    // Konsumen/Toko side: a real product + a real POS sale through
    // createSale(), which posts via lib/journal.ts#postPosSale() with
    // sourceId: sale.id — the direct-attribution pattern this task adds to
    // getConsolidatedAssets.
    const unitToko = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProduct(admin.user.tenantId, {
      unitId: unitToko.id,
      sku: "SKU-BERAS-5KG",
      name: "Beras Premium 5kg",
      sellPrice: 15_000,
      costPrice: 9_000
    });
    await recordStockMovement(
      admin.user.tenantId,
      product.id,
      { type: "IN", quantity: 10, reason: "Restok awal" },
      admin.user.id
    );
    await setupSaleMappings(admin.accessToken);

    const sale = await createSale(
      admin.user.tenantId,
      { unitId: unitToko.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "CASH" },
      admin.user.id
    );
    // totalPrice = 15_000 * 3 = 45_000; totalCost = 9_000 * 3 = 27_000.
    expect(sale.totalAmount).toBe("45000");

    // Hand-calculated expected Toko ASET contribution: postPosSale() posts
    // two balanced pairs under this sale's sourceId — debit Kas 45_000 /
    // credit Penjualan 45_000 (revenue), and debit HPP 27_000 / credit
    // Persediaan 27_000 (COGS). Of those four lines, only Kas and Persediaan
    // are ASET-category (both DEBIT-normal; Penjualan is PENDAPATAN, HPP is
    // BEBAN, neither counted). Net ASET = Kas debit (+45_000) minus
    // Persediaan credit (-27_000) = 45_000 - 27_000 = 18_000 — i.e. cash goes
    // up by the sale price while inventory goes down by its cost, netting to
    // the sale's gross margin.
    const expectedTokoAssets = 18_000;

    const res = await request(app())
      .get("/api/ksu/consolidated")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.byUnit).toHaveLength(2);

    const kspTotal = res.body.data.byUnit.find((u: { unitId: string }) => u.unitId === unitKsp.id);
    const tokoTotal = res.body.data.byUnit.find((u: { unitId: string }) => u.unitId === unitToko.id);
    expect(kspTotal?.assets).toBe(5_000_000);
    expect(tokoTotal?.assets).toBe(expectedTokoAssets);
    expect(res.body.data.totalAssets).toBe(5_000_000 + expectedTokoAssets);
  });
});
