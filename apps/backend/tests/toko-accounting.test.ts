import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createMemberWithPokokSaving, createStaffSession, setupTenant } from "./helpers.js";
import { createProduct, recordStockMovement } from "../src/modules/konsumen/product.service.js";
import { createSale } from "../src/modules/konsumen/sale.service.js";
import { recordCreditRepayment } from "../src/modules/konsumen/credit.service.js";

/**
 * Toko <-> koperasi accounting connection, end to end: a Toko sale must reach
 * Neraca/Laba Rugi for a tenant that only used the in-app "generate standard
 * COA" button (no demo seed), a sale made *before* any mapping existed must be
 * recoverable via the explicit repost endpoint, and a half-mapped sale must
 * never post as a lopsided POSTED entry.
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

type Session = Awaited<ReturnType<typeof setupTenant>>;

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app()).post("/api/config/units").set(bearer(accessToken)).send({ type, name });
  return res.body.data as { id: string };
}

function generateStandardCoa(accessToken: string) {
  return request(app()).post("/api/config/accounts/generate-standard").set(bearer(accessToken));
}

async function createAccount(
  accessToken: string,
  data: { code: string; name: string; category: string; normalBalance: string }
) {
  const res = await request(app()).post("/api/config/accounts").set(bearer(accessToken)).send(data);
  return res.body.data as { id: string };
}

async function createSystemMapping(
  accessToken: string,
  transactionKind: string,
  debitAccountId: string,
  creditAccountId: string
) {
  await request(app())
    .post("/api/config/account-mappings")
    .set(bearer(accessToken))
    .send({ sourceType: "SYSTEM", transactionKind, debitAccountId, creditAccountId });
}

/** A KONSUMEN unit with one product (sell 15.000 / cost 9.000) and `stockQty` units on the shelf. */
async function seedToko(admin: Session, stockQty = 10) {
  const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
  const product = await createProduct(
    admin.user.tenantId,
    { unitId: unit.id, sku: "SKU-BERAS-5KG", name: "Beras Premium 5kg", sellPrice: 15_000, costPrice: 9_000 },
    admin.user.id
  );
  await recordStockMovement(
    admin.user.tenantId,
    product.id,
    { type: "IN", quantity: stockQty, reason: "Restok awal" },
    admin.user.id
  );
  return { unit, product };
}

function sell(
  admin: Session,
  unitId: string,
  productId: string,
  quantity: number,
  paymentMethod: "CASH" | "MEMBER_CREDIT" = "CASH",
  memberId?: string
) {
  return createSale(
    admin.user.tenantId,
    { unitId, items: [{ productId, quantity }], paymentMethod, ...(memberId ? { memberId } : {}) },
    admin.user.id
  );
}

function entryFor(tenantId: string, sourceType: "POS_SALE" | "MEMBER_CREDIT_REPAYMENT", sourceId: string) {
  return db.journalEntry.findFirstOrThrow({ where: { tenantId, sourceType, sourceId }, include: { lines: true } });
}

interface LabaRugiBody {
  pendapatan: { items: Array<{ name: string; total: string }> };
  beban: { items: Array<{ name: string; total: string }> };
  shuBerjalan: string;
}

async function labaRugi(accessToken: string): Promise<LabaRugiBody> {
  const res = await request(app()).get("/api/reports/regulatory/laporan-hasil-usaha").set(bearer(accessToken));
  expect(res.status).toBe(200);
  return res.body.data as LabaRugiBody;
}

const totalOf = (section: LabaRugiBody["pendapatan"], name: string) => section.items.find((i) => i.name === name)?.total;

describe("Toko sale on a tenant that only used 'generate standard COA'", () => {
  it("posts a balanced entry that reaches Laba Rugi as Penjualan + HPP and keeps Neraca balanced", async () => {
    const admin = await setupTenant();
    const { unit, product } = await seedToko(admin);
    await generateStandardCoa(admin.accessToken);

    const sale = await sell(admin, unit.id, product.id, 3);
    expect(sale.totalAmount).toBe("45000");

    const entry = await entryFor(admin.user.tenantId, "POS_SALE", sale.id);
    expect(entry.status).toBe("POSTED");
    expect(entry.lines).toHaveLength(4);

    const report = await labaRugi(admin.accessToken);
    expect(totalOf(report.pendapatan, "Penjualan Barang Dagang")).toBe("45000");
    expect(totalOf(report.beban, "Harga Pokok Penjualan")).toBe("27000");
    expect(report.shuBerjalan).toBe("18000");

    const neraca = await request(app()).get("/api/reports/regulatory/neraca").set(bearer(admin.accessToken));
    expect(neraca.status).toBe(200);
    expect(neraca.body.data.balanced).toBe(true);
  });

  it("posts a Kredit Anggota sale to Piutang Anggota (Toko) and its repayment to Kas/Piutang", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken); // credit limit 250.000
    const { unit, product } = await seedToko(admin);
    await generateStandardCoa(admin.accessToken);
    const piutang = await db.account.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, code: "1-1150" } });

    const sale = await sell(admin, unit.id, product.id, 2, "MEMBER_CREDIT", member.id);
    const saleEntry = await entryFor(admin.user.tenantId, "POS_SALE", sale.id);
    expect(saleEntry.status).toBe("POSTED");
    expect(saleEntry.lines).toHaveLength(4);
    expect(Number(saleEntry.lines.find((l) => l.accountId === piutang.id)!.debit)).toBe(30_000);

    const repayment = await recordCreditRepayment(
      admin.user.tenantId,
      { memberId: member.id, amount: 10_000 },
      admin.user.id
    );
    const repaymentEntry = await entryFor(admin.user.tenantId, "MEMBER_CREDIT_REPAYMENT", repayment.id);
    expect(repaymentEntry.status).toBe("POSTED");
    expect(repaymentEntry.lines).toHaveLength(2);
    expect(Number(repaymentEntry.lines.find((l) => l.accountId === piutang.id)!.credit)).toBe(10_000);
  });
});

describe("Half-mapped Toko sale (all-or-nothing posting)", () => {
  it("stays UNPOSTED with no lines when only the revenue mapping exists, and posts once COGS is mapped and reposted", async () => {
    const admin = await setupTenant();
    const { unit, product } = await seedToko(admin);
    const kas = await createAccount(admin.accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
    const penjualan = await createAccount(admin.accessToken, {
      code: "4-1000",
      name: "Penjualan",
      category: "PENDAPATAN",
      normalBalance: "KREDIT"
    });
    await createSystemMapping(admin.accessToken, "SALE_REVENUE", kas.id, penjualan.id);

    const sale = await sell(admin, unit.id, product.id, 3);

    const lopsided = await entryFor(admin.user.tenantId, "POS_SALE", sale.id);
    expect(lopsided.status).toBe("UNPOSTED_MISSING_MAPPING");
    expect(lopsided.lines).toEqual([]);

    const hpp = await createAccount(admin.accessToken, { code: "5-1000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
    const persediaan = await createAccount(admin.accessToken, {
      code: "1-1300",
      name: "Persediaan Barang Dagang",
      category: "ASET",
      normalBalance: "DEBIT"
    });
    await createSystemMapping(admin.accessToken, "SALE_COGS", hpp.id, persediaan.id);

    const repost = await request(app()).post("/api/config/journal/repost").set(bearer(admin.accessToken));
    expect(repost.status).toBe(200);
    // The sale is now fully mapped and posts. The restock that stocked the shelf (made before any
    // mapping) stays unposted: this hand-wired scenario never mapped STOCK_PURCHASE.
    expect(repost.body.data).toEqual({ reposted: 1, stillUnmapped: 1 });

    const complete = await entryFor(admin.user.tenantId, "POS_SALE", sale.id);
    expect(complete.status).toBe("POSTED");
    expect(complete.lines).toHaveLength(4);
  });
});

describe("Reposting entries that were UNPOSTED_MISSING_MAPPING", () => {
  it("recovers Toko sales and repayments made before any mapping existed, reports them, and is idempotent", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const { unit, product } = await seedToko(admin);

    // Everything below happens with NO account mapping at all.
    const cashSale = await sell(admin, unit.id, product.id, 3);
    const creditSale = await sell(admin, unit.id, product.id, 2, "MEMBER_CREDIT", member.id);
    const repayment = await recordCreditRepayment(
      admin.user.tenantId,
      { memberId: member.id, amount: 10_000 },
      admin.user.id
    );
    for (const [type, id] of [
      ["POS_SALE", cashSale.id],
      ["POS_SALE", creditSale.id],
      ["MEMBER_CREDIT_REPAYMENT", repayment.id]
    ] as const) {
      const entry = await entryFor(admin.user.tenantId, type, id);
      expect(entry.status).toBe("UNPOSTED_MISSING_MAPPING");
      expect(entry.lines).toEqual([]);
    }

    const before = await request(app()).get("/api/config/journal/unposted").set(bearer(admin.accessToken));
    expect(before.status).toBe(200);
    expect(before.body.data.repostableCount).toBe(4); // 2 sales + 1 repayment + the shelf-stocking restock
    expect(before.body.data.items).toEqual(
      expect.arrayContaining([
        { sourceType: "POS_SALE", count: 2, repostable: true },
        { sourceType: "MEMBER_CREDIT_REPAYMENT", count: 1, repostable: true },
        { sourceType: "STOCK_MOVEMENT", count: 1, repostable: true },
        // Savings/loan entries are listed but not repostable by this feature.
        { sourceType: "SAVING_TRANSACTION", count: 1, repostable: false }
      ])
    );

    await generateStandardCoa(admin.accessToken);
    const repost = await request(app()).post("/api/config/journal/repost").set(bearer(admin.accessToken));
    expect(repost.status).toBe(200);
    expect(repost.body.data).toEqual({ reposted: 4, stillUnmapped: 0 });

    expect((await entryFor(admin.user.tenantId, "POS_SALE", cashSale.id)).lines).toHaveLength(4);
    expect((await entryFor(admin.user.tenantId, "POS_SALE", creditSale.id)).lines).toHaveLength(4);
    expect((await entryFor(admin.user.tenantId, "MEMBER_CREDIT_REPAYMENT", repayment.id)).lines).toHaveLength(2);

    const report = await labaRugi(admin.accessToken);
    expect(totalOf(report.pendapatan, "Penjualan Barang Dagang")).toBe("75000"); // 45.000 + 30.000
    expect(totalOf(report.beban, "Harga Pokok Penjualan")).toBe("45000"); // 27.000 + 18.000

    const again = await request(app()).post("/api/config/journal/repost").set(bearer(admin.accessToken));
    expect(again.body.data).toEqual({ reposted: 0, stillUnmapped: 0 });

    const after = await request(app()).get("/api/config/journal/unposted").set(bearer(admin.accessToken));
    expect(after.body.data.repostableCount).toBe(0);
  });

  it("leaves entries it cannot map yet untouched and counts them as stillUnmapped", async () => {
    const admin = await setupTenant();
    const { unit, product } = await seedToko(admin);
    const sale = await sell(admin, unit.id, product.id, 1);

    const repost = await request(app()).post("/api/config/journal/repost").set(bearer(admin.accessToken));

    expect(repost.status).toBe(200);
    expect(repost.body.data).toEqual({ reposted: 0, stillUnmapped: 2 }); // the sale and the restock that stocked the shelf
    const entry = await entryFor(admin.user.tenantId, "POS_SALE", sale.id);
    expect(entry.status).toBe("UNPOSTED_MISSING_MAPPING");
    expect(entry.lines).toEqual([]);
  });

  it("never touches another tenant's unposted entries", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const tokoA = await seedToko(tenantA);
    const tokoB = await seedToko(tenantB);
    await sell(tenantA, tokoA.unit.id, tokoA.product.id, 1);
    const saleB = await sell(tenantB, tokoB.unit.id, tokoB.product.id, 1);

    await generateStandardCoa(tenantA.accessToken);
    const repostA = await request(app()).post("/api/config/journal/repost").set(bearer(tenantA.accessToken));
    expect(repostA.body.data).toEqual({ reposted: 2, stillUnmapped: 0 }); // A's sale + A's restock

    const entryB = await entryFor(tenantB.user.tenantId, "POS_SALE", saleB.id);
    expect(entryB.status).toBe("UNPOSTED_MISSING_MAPPING");
    const summaryB = await request(app()).get("/api/config/journal/unposted").set(bearer(tenantB.accessToken));
    expect(summaryB.body.data.repostableCount).toBe(2); // B's sale + B's restock, both untouched
  });

  it("rejects a Viewer (accounting.create not granted) and a tenant without the accounting entitlement", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");
    const viewerRes = await request(app()).post("/api/config/journal/repost").set(bearer(viewer.accessToken));
    expect(viewerRes.status).toBe(403);

    const plain = await setupTenant({ slug: "plain", registrationNo: "KOP-PLAIN" }, { entitled: false });
    const summary = await request(app()).get("/api/config/journal/unposted").set(bearer(plain.accessToken));
    expect(summary.status).toBe(403);
    expect(summary.body.error.code).toBe("FEATURE_NOT_ENTITLED");
    const repost = await request(app()).post("/api/config/journal/repost").set(bearer(plain.accessToken));
    expect(repost.status).toBe(403);
    expect(repost.body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });
});

describe("Laporan Arus Kas", () => {
  it("labels Toko cash receipts as such instead of 'Transaksi Manual Lainnya'", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const { unit, product } = await seedToko(admin);
    await generateStandardCoa(admin.accessToken);

    await sell(admin, unit.id, product.id, 3); // cash in: 45.000
    await sell(admin, unit.id, product.id, 2, "MEMBER_CREDIT", member.id); // on credit: no cash yet
    await recordCreditRepayment(admin.user.tenantId, { memberId: member.id, amount: 10_000 }, admin.user.id);

    const res = await request(app()).get("/api/reports/regulatory/arus-kas").set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    const operasi = res.body.data.aktivitasOperasi.rincian as Array<{ label: string; amount: string }>;
    expect(operasi).toEqual(
      expect.arrayContaining([
        { label: "Penerimaan Penjualan Toko", amount: "45000" },
        { label: "Pelunasan Kredit Anggota (Toko)", amount: "10000" }
      ])
    );
    expect(operasi.map((r) => r.label)).not.toContain("Transaksi Manual Lainnya");
    expect(res.body.data.balanced).toBe(true);
  });
});

describe("GET /api/ksu/consolidated — total ties to Neraca", () => {
  it("attributes a savings deposit to its unit and leaves only unit-less entries as 'unallocated'", async () => {
    const admin = await setupTenant();
    const kspUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    // A saving config first, so "Buat COA Standar" also wires its DEPOSIT mapping (Kas / Simpanan Pokok).
    const config = await request(app())
      .post("/api/savings/configs")
      .set(bearer(admin.accessToken))
      .send({ name: "Simpanan Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
    const { unit: tokoUnit, product } = await seedToko(admin);
    await generateStandardCoa(admin.accessToken);

    // Kas +500.000 via a SAVING_TRANSACTION entry — it carries the saving's unit (the default KSP unit).
    const member = await createMemberAs(admin.accessToken);
    await request(app())
      .post("/api/savings")
      .set(bearer(admin.accessToken))
      .send({ memberId: member.id, savingConfigId: config.body.data.id, initialDeposit: 500_000 });
    // Kas +45.000, Persediaan -27.000 => +18.000 of assets, attributed to the Toko unit.
    await sell(admin, tokoUnit.id, product.id, 3);
    // A manual entry belongs to no unit: Kas +100.000 against Simpanan Pokok.
    const kas = await db.account.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, code: "1-1000" } });
    const simpananPokok = await db.account.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, code: "3-1000" } });
    await db.journalEntry.create({
      data: {
        tenantId: admin.user.tenantId,
        entryDate: new Date(),
        sourceType: "MANUAL",
        description: "Modal awal",
        status: "POSTED",
        lines: {
          create: [
            { tenantId: admin.user.tenantId, accountId: kas.id, debit: 100_000 },
            { tenantId: admin.user.tenantId, accountId: simpananPokok.id, credit: 100_000 }
          ]
        }
      }
    });

    const consolidated = await request(app()).get("/api/ksu/consolidated").set(bearer(admin.accessToken));
    const neraca = await request(app()).get("/api/reports/regulatory/neraca").set(bearer(admin.accessToken));

    expect(consolidated.status).toBe(200);
    const byUnit = consolidated.body.data.byUnit as Array<{ unitId: string; assets: number }>;
    expect(byUnit.find((u) => u.unitId === kspUnit.id)?.assets).toBe(500_000);
    expect(byUnit.find((u) => u.unitId === tokoUnit.id)?.assets).toBe(18_000);
    expect(consolidated.body.data.unallocated).toBe(100_000);
    expect(consolidated.body.data.totalAssets).toBe(618_000);
    expect(String(consolidated.body.data.totalAssets)).toBe(neraca.body.data.aset.total);
  });
});
