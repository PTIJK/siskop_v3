import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, createStaffSession, setupTenant } from "./helpers.js";
import { createProduct, recordStockMovement } from "../src/modules/konsumen/product.service.js";
import { createSale } from "../src/modules/konsumen/sale.service.js";

/**
 * Laporan Toko (GET /api/konsumen/reports/sales): the operational view of a
 * Toko unit's trading — omzet, HPP, laba kotor, payment mix, best sellers,
 * stock. It reads POSSale rows directly (not the journal), so the contract
 * test at the bottom is what proves it agrees with the ledger-derived Laba Rugi.
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
const today = () => format(new Date(), "yyyy-MM-dd");

async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app()).post("/api/config/units").set(bearer(accessToken)).send({ type, name });
  return res.body.data as { id: string };
}

async function addProduct(
  admin: Session,
  unitId: string,
  p: { sku: string; name: string; sellPrice: number; costPrice: number; stock: number }
) {
  const product = await createProduct(
    admin.user.tenantId,
    { unitId, sku: p.sku, name: p.name, sellPrice: p.sellPrice, costPrice: p.costPrice },
    admin.user.id
  );
  await recordStockMovement(
    admin.user.tenantId,
    product.id,
    { type: "IN", quantity: p.stock, reason: "Restok awal" },
    admin.user.id
  );
  return product;
}

function sell(
  admin: Session,
  unitId: string,
  items: Array<{ productId: string; quantity: number }>,
  paymentMethod: "CASH" | "TRANSFER" | "MEMBER_CREDIT" = "CASH",
  memberId?: string
) {
  return createSale(
    admin.user.tenantId,
    { unitId, items, paymentMethod, ...(memberId ? { memberId } : {}) },
    admin.user.id
  );
}

function salesReport(accessToken: string, query = "") {
  return request(app()).get(`/api/konsumen/reports/sales${query}`).set(bearer(accessToken));
}

const BERAS = { sku: "SKU-BERAS", name: "Beras Premium 5kg", sellPrice: 15_000, costPrice: 9_000, stock: 20 };
const MINYAK = { sku: "SKU-MINYAK", name: "Minyak Goreng 2L", sellPrice: 32_000, costPrice: 28_000, stock: 5 };

describe("GET /api/konsumen/reports/sales", () => {
  it("summarises omzet, HPP, laba kotor, payment mix, best sellers, stock and store credit for a unit", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken); // credit limit 250.000
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const beras = await addProduct(admin, unit.id, BERAS);
    const minyak = await addProduct(admin, unit.id, MINYAK);

    await sell(admin, unit.id, [{ productId: beras.id, quantity: 3 }], "CASH"); // 45.000 / HPP 27.000
    await sell(
      admin,
      unit.id,
      [
        { productId: minyak.id, quantity: 1 },
        { productId: beras.id, quantity: 2 }
      ],
      "TRANSFER"
    ); // 62.000 / HPP 46.000
    await sell(admin, unit.id, [{ productId: beras.id, quantity: 2 }], "MEMBER_CREDIT", member.id); // 30.000 / HPP 18.000

    const res = await salesReport(admin.accessToken, `?unitId=${unit.id}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.unitId).toBe(unit.id);
    expect(data.periode).toEqual({
      from: format(startOfMonth(new Date()), "yyyy-MM-dd"),
      to: format(endOfMonth(new Date()), "yyyy-MM-dd")
    });
    expect(data.ringkasan).toEqual({
      omzet: "137000",
      hpp: "91000",
      labaKotor: "46000",
      marginPercent: 33.58, // 46.000 / 137.000
      transactionCount: 3,
      itemsSold: 8
    });
    expect(data.perMetodeBayar).toEqual([
      { paymentMethod: "CASH", count: 1, total: "45000" },
      { paymentMethod: "TRANSFER", count: 1, total: "62000" },
      { paymentMethod: "MEMBER_CREDIT", count: 1, total: "30000" }
    ]);
    expect(data.produkTerlaris).toEqual([
      { productId: beras.id, sku: "SKU-BERAS", name: "Beras Premium 5kg", quantity: 7, omzet: "105000", hpp: "63000", labaKotor: "42000" },
      { productId: minyak.id, sku: "SKU-MINYAK", name: "Minyak Goreng 2L", quantity: 1, omzet: "32000", hpp: "28000", labaKotor: "4000" }
    ]);
    expect(data.tren).toEqual([{ date: today(), omzet: "137000", labaKotor: "46000", count: 3 }]);
    // Beras 20-7=13 @9.000 + Minyak 5-1=4 @28.000
    expect(data.persediaan).toEqual({ productCount: 2, outOfStockCount: 0, stockValue: "229000" });
    expect(data.mutasiStok).toEqual([
      { type: "IN", count: 2, quantity: 25 },
      { type: "OUT", count: 4, quantity: 8 }
    ]);
    expect(data.piutangAnggota).toBe("30000"); // the unpaid Kredit Anggota sale
  });

  it("returns zeros and empty lists for a period with no sales, but still reports current stock", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const beras = await addProduct(admin, unit.id, BERAS);
    await sell(admin, unit.id, [{ productId: beras.id, quantity: 3 }]);

    const res = await salesReport(admin.accessToken, `?unitId=${unit.id}&from=2000-01-01&to=2000-01-31`);

    expect(res.status).toBe(200);
    expect(res.body.data.ringkasan).toEqual({
      omzet: "0",
      hpp: "0",
      labaKotor: "0",
      marginPercent: 0,
      transactionCount: 0,
      itemsSold: 0
    });
    expect(res.body.data.perMetodeBayar).toEqual([]);
    expect(res.body.data.produkTerlaris).toEqual([]);
    expect(res.body.data.tren).toEqual([]);
    expect(res.body.data.persediaan.productCount).toBe(1); // stock is a snapshot, not period-bound
  });

  it("includes a sale made moments ago when `to` is today (the upper bound is end-of-day, not midnight)", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const beras = await addProduct(admin, unit.id, BERAS);
    await sell(admin, unit.id, [{ productId: beras.id, quantity: 3 }]);

    const res = await salesReport(admin.accessToken, `?unitId=${unit.id}&from=${today()}&to=${today()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ringkasan.omzet).toBe("45000");
    expect(res.body.data.ringkasan.transactionCount).toBe(1);
  });

  it("rejects a reversed or malformed period", async () => {
    const admin = await setupTenant();

    const reversed = await salesReport(admin.accessToken, "?from=2026-09-30&to=2026-09-01");
    expect(reversed.status).toBe(422); // ErrorCode.VALIDATION_ERROR
    expect(reversed.body.error.code).toBe("VALIDATION_ERROR");

    const malformed = await salesReport(admin.accessToken, "?from=30-09-2026");
    expect(malformed.status).toBe(422);
  });
});

describe("GET /api/konsumen/reports/sales — unit scope", () => {
  async function twoTokoUnits(admin: Session) {
    const unitA = await createUnit(admin.accessToken, "KONSUMEN", "Toko A");
    const unitB = await createUnit(admin.accessToken, "KONSUMEN", "Toko B");
    const berasA = await addProduct(admin, unitA.id, BERAS);
    const minyakB = await addProduct(admin, unitB.id, MINYAK);
    await sell(admin, unitA.id, [{ productId: berasA.id, quantity: 3 }]); // 45.000
    await sell(admin, unitB.id, [{ productId: minyakB.id, quantity: 1 }]); // 32.000
    return { unitA, unitB };
  }

  it("reports one unit with unitId, and every accessible unit combined when unitId is omitted", async () => {
    const admin = await setupTenant();
    const { unitA, unitB } = await twoTokoUnits(admin);

    const a = await salesReport(admin.accessToken, `?unitId=${unitA.id}`);
    const b = await salesReport(admin.accessToken, `?unitId=${unitB.id}`);
    const all = await salesReport(admin.accessToken);

    expect(a.body.data.ringkasan.omzet).toBe("45000");
    expect(b.body.data.ringkasan.omzet).toBe("32000");
    expect(all.body.data.unitId).toBeNull();
    expect(all.body.data.ringkasan.omzet).toBe("77000");
    expect(all.body.data.ringkasan.transactionCount).toBe(2);
  });

  it("limits a user scoped to one unit to that unit, and forbids naming another", async () => {
    const admin = await setupTenant();
    const { unitA, unitB } = await twoTokoUnits(admin);
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");
    await db.userUnit.create({ data: { userId: manager.user.id, unitId: unitA.id } });

    const combined = await salesReport(manager.accessToken);
    expect(combined.status).toBe(200);
    expect(combined.body.data.ringkasan.omzet).toBe("45000"); // Toko B's 32.000 is not theirs to see

    const other = await salesReport(manager.accessToken, `?unitId=${unitB.id}`);
    expect(other.status).toBe(403);
  });

  it("404s a unit that belongs to another tenant, and never mixes tenants' sales", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");
    const berasB = await addProduct(tenantB, unitB.id, BERAS);
    await sell(tenantB, unitB.id, [{ productId: berasB.id, quantity: 3 }]);

    const cross = await salesReport(tenantA.accessToken, `?unitId=${unitB.id}`);
    expect(cross.status).toBe(404);

    const own = await salesReport(tenantA.accessToken);
    expect(own.status).toBe(200);
    expect(own.body.data.ringkasan.omzet).toBe("0");
  });
});

describe("GET /api/konsumen/reports/sales — access", () => {
  it("is a report: allowed for a Viewer (reports.read), refused for a Kasir (Toko-only, no reports)", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");

    expect((await salesReport(viewer.accessToken)).status).toBe(200);
    expect((await salesReport(kasir.accessToken)).status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(app()).get("/api/konsumen/reports/sales");
    expect(res.status).toBe(401);
  });
});

describe("Laporan Toko agrees with the ledger (Laba Rugi)", () => {
  it("omzet equals Penjualan Barang Dagang and HPP equals Harga Pokok Penjualan for the same period", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const beras = await addProduct(admin, unit.id, BERAS);
    await request(app()).post("/api/config/accounts/generate-standard").set(bearer(admin.accessToken));

    await sell(admin, unit.id, [{ productId: beras.id, quantity: 3 }], "CASH");
    await sell(admin, unit.id, [{ productId: beras.id, quantity: 2 }], "MEMBER_CREDIT", member.id);

    const report = await salesReport(admin.accessToken, `?unitId=${unit.id}`);
    const labaRugi = await request(app())
      .get("/api/reports/regulatory/laporan-hasil-usaha")
      .set(bearer(admin.accessToken));

    const penjualan = labaRugi.body.data.pendapatan.items.find(
      (i: { name: string }) => i.name === "Penjualan Barang Dagang"
    );
    const hpp = labaRugi.body.data.beban.items.find((i: { name: string }) => i.name === "Harga Pokok Penjualan");
    expect(report.body.data.ringkasan.omzet).toBe("75000");
    expect(report.body.data.ringkasan.omzet).toBe(penjualan.total);
    expect(report.body.data.ringkasan.hpp).toBe("45000");
    expect(report.body.data.ringkasan.hpp).toBe(hpp.total);
    expect(report.body.data.ringkasan.labaKotor).toBe(labaRugi.body.data.shuBerjalan);
  });
});
