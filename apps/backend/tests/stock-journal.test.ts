import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";
import { createProduct, recordStockMovement } from "../src/modules/konsumen/product.service.js";
import { createSale } from "../src/modules/konsumen/sale.service.js";

/**
 * Restocking a Toko is a purchase: the shelf gets more goods and the koperasi
 * pays for them. Until now nothing was journaled for it, so Persediaan was only
 * ever credited (by HPP) and went negative in Neraca. A restock (`IN`) now
 * posts Dr Persediaan / Cr Kas at product cost x quantity through the tenant's
 * SYSTEM/STOCK_PURCHASE mapping (an admin can point the credit side at Utang
 * Usaha instead).
 *
 * `ADJUSTMENT` is deliberately NOT journaled: it *sets* the stock to a counted
 * quantity and the previous quantity isn't stored, so the delta (and therefore
 * the value) can't be recovered later.
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

const generateStandardCoa = (accessToken: string) =>
  request(app()).post("/api/config/accounts/generate-standard").set(bearer(accessToken));

async function tokoWithProduct(admin: Session, costPrice = 9_000) {
  const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
  const product = await createProduct(
    admin.user.tenantId,
    { unitId: unit.id, sku: `SKU-${costPrice}`, name: "Beras Premium 5kg", sellPrice: 15_000, costPrice },
    admin.user.id
  );
  return { unit, product };
}

const restock = (admin: Session, productId: string, quantity: number) =>
  recordStockMovement(admin.user.tenantId, productId, { type: "IN", quantity, reason: "Restok" }, admin.user.id);

function stockEntries(tenantId: string) {
  return db.journalEntry.findMany({ where: { tenantId, sourceType: "STOCK_MOVEMENT" }, include: { lines: true }, orderBy: { createdAt: "asc" } });
}

async function neracaBalance(admin: Session, name: string): Promise<number> {
  const res = await request(app()).get("/api/reports/regulatory/neraca").set(bearer(admin.accessToken));
  expect(res.status).toBe(200);
  return Number((res.body.data.aset.items as Array<{ name: string; balance: string }>).find((i) => i.name === name)?.balance ?? 0);
}

describe("restocking a Toko", () => {
  it("posts Dr Persediaan / Cr Kas at cost x quantity, stamped with the Toko's unit", async () => {
    const admin = await setupTenant();
    const { unit, product } = await tokoWithProduct(admin);
    await generateStandardCoa(admin.accessToken);

    await restock(admin, product.id, 10);

    const movement = await db.stockMovement.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, productId: product.id, type: "IN" } });
    const [entry] = await stockEntries(admin.user.tenantId);
    expect(entry).toMatchObject({ sourceId: movement.id, status: "POSTED", unitId: unit.id });
    expect(entry!.lines).toHaveLength(2);
    const persediaan = await db.account.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, code: "1-1300" } });
    const kas = await db.account.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, code: "1-1000" } });
    expect(Number(entry!.lines.find((l) => l.accountId === persediaan.id)!.debit)).toBe(90_000); // 10 x 9.000
    expect(Number(entry!.lines.find((l) => l.accountId === kas.id)!.credit)).toBe(90_000);
  });

  it("keeps Persediaan in Neraca equal to the stock value in Laporan Toko, so it never goes negative", async () => {
    const admin = await setupTenant();
    const { unit, product } = await tokoWithProduct(admin);
    await generateStandardCoa(admin.accessToken);

    await restock(admin, product.id, 10);
    await createSale(
      admin.user.tenantId,
      { unitId: unit.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "CASH" },
      admin.user.id
    );

    // 10 bought - 3 sold = 7 on the shelf @ 9.000
    const report = await request(app()).get(`/api/konsumen/reports/sales?unitId=${unit.id}`).set(bearer(admin.accessToken));
    expect(report.body.data.persediaan.stockValue).toBe("63000");
    expect(await neracaBalance(admin, "Persediaan Barang Dagang")).toBe(63_000);
    const neraca = await request(app()).get("/api/reports/regulatory/neraca").set(bearer(admin.accessToken));
    expect(neraca.body.data.balanced).toBe(true);
  });

  it("shows the purchase as its own line in Arus Kas", async () => {
    const admin = await setupTenant();
    const { product } = await tokoWithProduct(admin);
    await generateStandardCoa(admin.accessToken);

    await restock(admin, product.id, 10);

    const res = await request(app()).get("/api/reports/regulatory/arus-kas").set(bearer(admin.accessToken));
    const operasi = res.body.data.aktivitasOperasi.rincian as Array<{ label: string; amount: string }>;
    expect(operasi).toEqual([{ label: "Pembelian Persediaan Toko", amount: "-90000" }]);
  });

  it("does not journal an ADJUSTMENT (it sets the count; the delta isn't recoverable) nor a zero-cost restock", async () => {
    const admin = await setupTenant();
    const { unit, product } = await tokoWithProduct(admin);
    const free = await createProduct(
      admin.user.tenantId,
      { unitId: unit.id, sku: "SKU-FREE", name: "Bonus", sellPrice: 1_000, costPrice: 0 },
      admin.user.id
    );
    await generateStandardCoa(admin.accessToken);

    await recordStockMovement(admin.user.tenantId, product.id, { type: "ADJUSTMENT", quantity: 25, reason: "Stok opname" }, admin.user.id);
    await restock(admin, free.id, 5);

    expect(await stockEntries(admin.user.tenantId)).toEqual([]);
  });

  it("leaves a restock made before the mapping existed unposted, and the repost recovers it", async () => {
    const admin = await setupTenant();
    const { product } = await tokoWithProduct(admin);
    await restock(admin, product.id, 10); // no mapping yet

    const [pending] = await stockEntries(admin.user.tenantId);
    expect(pending).toMatchObject({ status: "UNPOSTED_MISSING_MAPPING" });
    expect(pending!.lines).toEqual([]);
    const summary = await request(app()).get("/api/config/journal/unposted").set(bearer(admin.accessToken));
    expect(summary.body.data.items).toEqual(expect.arrayContaining([{ sourceType: "STOCK_MOVEMENT", count: 1, repostable: true }]));

    await generateStandardCoa(admin.accessToken);
    const repost = await request(app()).post("/api/config/journal/repost").set(bearer(admin.accessToken));

    expect(repost.body.data).toEqual({ reposted: 1, stillUnmapped: 0 });
    expect(await neracaBalance(admin, "Persediaan Barang Dagang")).toBe(90_000);
  });
});

describe("the migration's backfill of restocks made before this feature", () => {
  const migration = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../prisma/migrations/20260920120000_stock_purchase_journal_backfill/migration.sql"
  );

  function backfillStatements(): string[] {
    const block = readFileSync(migration, "utf8").split("-- backfill:start")[1]?.split("-- backfill:end")[0] ?? "";
    return block
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  it("creates an UNPOSTED placeholder per costed restock — no financial effect until an admin reposts — and is idempotent", async () => {
    const admin = await setupTenant();
    const { unit, product } = await tokoWithProduct(admin);
    const free = await createProduct(
      admin.user.tenantId,
      { unitId: unit.id, sku: "SKU-FREE", name: "Bonus", sellPrice: 1_000, costPrice: 0 },
      admin.user.id
    );
    await generateStandardCoa(admin.accessToken);
    await restock(admin, product.id, 10);
    await restock(admin, free.id, 5);
    await recordStockMovement(admin.user.tenantId, product.id, { type: "ADJUSTMENT", quantity: 12, reason: "Stok opname" }, admin.user.id);
    // Simulate movements recorded before the feature: no journal entry at all.
    await db.journalEntry.deleteMany({ where: { tenantId: admin.user.tenantId, sourceType: "STOCK_MOVEMENT" } });
    const movement = await db.stockMovement.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, productId: product.id, type: "IN" } });

    for (const statement of backfillStatements()) await db.$executeRawUnsafe(statement);
    const first = await stockEntries(admin.user.tenantId);

    // Only the costed IN — not the zero-cost restock, not the ADJUSTMENT.
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ sourceId: movement.id, status: "UNPOSTED_MISSING_MAPPING", unitId: unit.id });
    expect(first[0]!.lines).toEqual([]);
    expect(first[0]!.entryDate.getTime()).toBe(movement.createdAt.getTime());
    expect(await neracaBalance(admin, "Persediaan Barang Dagang")).toBe(0);

    for (const statement of backfillStatements()) await db.$executeRawUnsafe(statement);
    expect(await stockEntries(admin.user.tenantId)).toHaveLength(1);

    const repost = await request(app()).post("/api/config/journal/repost").set(bearer(admin.accessToken));
    expect(repost.body.data).toEqual({ reposted: 1, stillUnmapped: 0 });
    expect(await neracaBalance(admin, "Persediaan Barang Dagang")).toBe(90_000);
  });
});
