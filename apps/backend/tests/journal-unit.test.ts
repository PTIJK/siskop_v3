import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "date-fns";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createStaffSession, setupTenant } from "./helpers.js";
import { createProduct, recordStockMovement } from "../src/modules/konsumen/product.service.js";
import { createSale } from "../src/modules/konsumen/sale.service.js";
import { recordCreditRepayment } from "../src/modules/konsumen/credit.service.js";
import { recordLoanPayment } from "../src/modules/loans/service.js";
import { runDailySavingInterestAccrual } from "../src/modules/savings/daily-interest.js";

/**
 * A journal entry carries the unit its source transaction belongs to, so
 * Neraca / Arus Kas / Laba Rugi can be cut per unit and the per-unit views
 * reconcile with the consolidated one. Entries that belong to no single unit
 * (a manual entry, a member-credit repayment) keep a NULL unitId — the
 * tenant-level "unallocated" bucket.
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });
const today = () => format(new Date(), "yyyy-MM-dd");

async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app()).post("/api/config/units").set(bearer(accessToken)).send({ type, name });
  return res.body.data as { id: string };
}

/**
 * Three units and one of every kind of unit-bound transaction:
 *   A (KSP, the default unit) — a 500.000 saving deposit
 *   B (KSP)                   — a 5.000.000 loan and a 100.000 payment on it
 *   T (KONSUMEN)              — a cash sale (45.000 / HPP 27.000) and a Kredit Anggota sale (30.000 / HPP 18.000)
 * plus a member-credit repayment, which belongs to no unit.
 */
async function buildLedger() {
  const admin = await setupTenant();
  const tenantId = admin.user.tenantId;
  const unitA = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
  const unitB = await createUnit(admin.accessToken, "KSP", "Simpan Pinjam B");
  const unitT = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

  const savingConfig = await request(app())
    .post("/api/savings/configs")
    .set(bearer(admin.accessToken))
    .send({ name: "Simpanan Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
  const loanConfig = await request(app())
    .post("/api/loans/configs")
    .set(bearer(admin.accessToken))
    .send({ name: "KUR Mikro", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
  // With both configs and the Toko unit in place, "Buat COA Standar" wires every mapping this ledger needs.
  await request(app()).post("/api/config/accounts/generate-standard").set(bearer(admin.accessToken));

  const member = await createMemberAs(admin.accessToken);
  await request(app())
    .post("/api/savings")
    .set(bearer(admin.accessToken))
    .send({ memberId: member.id, savingConfigId: savingConfig.body.data.id, initialDeposit: 500_000 });

  const loan = await request(app())
    .post("/api/loans")
    .set(bearer(admin.accessToken))
    .send({ memberId: member.id, loanConfigId: loanConfig.body.data.id, principalAmount: 5_000_000, termMonths: 12, unitId: unitB.id });
  expect(loan.status).toBe(201);
  await recordLoanPayment(
    tenantId,
    loan.body.data.id,
    { amount: 100_000, penalty: 0, paidAt: today(), dueDate: today() },
    admin.user.id
  );

  const product = await createProduct(
    tenantId,
    { unitId: unitT.id, sku: "SKU-BERAS", name: "Beras Premium 5kg", sellPrice: 15_000, costPrice: 9_000 },
    admin.user.id
  );
  await recordStockMovement(tenantId, product.id, { type: "IN", quantity: 20, reason: "Restok awal" }, admin.user.id);
  const cashSale = await createSale(
    tenantId,
    { unitId: unitT.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "CASH" },
    admin.user.id
  );
  const creditSale = await createSale(
    tenantId,
    { unitId: unitT.id, items: [{ productId: product.id, quantity: 2 }], paymentMethod: "MEMBER_CREDIT", memberId: member.id },
    admin.user.id
  );
  const repayment = await recordCreditRepayment(tenantId, { memberId: member.id, amount: 10_000 }, admin.user.id);

  return {
    admin,
    tenantId,
    unitA,
    unitB,
    unitT,
    member,
    loanId: loan.body.data.id as string,
    saleIds: [cashSale.id, creditSale.id],
    repaymentId: repayment.id
  };
}

type Ledger = Awaited<ReturnType<typeof buildLedger>>;

async function unitOfEntries(tenantId: string) {
  const entries = await db.journalEntry.findMany({ where: { tenantId }, select: { sourceType: true, sourceId: true, unitId: true } });
  const byType = (type: string) => entries.filter((e) => e.sourceType === type);
  return { entries, byType };
}

function expectStamped(ledger: Ledger, entries: Awaited<ReturnType<typeof unitOfEntries>>) {
  expect(entries.byType("SAVING_TRANSACTION").map((e) => e.unitId)).toEqual([ledger.unitA.id]);
  expect(entries.byType("LOAN_DISBURSEMENT").map((e) => e.unitId)).toEqual([ledger.unitB.id]);
  expect(entries.byType("LOAN_PAYMENT").map((e) => e.unitId)).toEqual([ledger.unitB.id]);
  expect(entries.byType("POS_SALE").map((e) => e.unitId)).toEqual([ledger.unitT.id, ledger.unitT.id]);
  expect(entries.byType("MEMBER_CREDIT_REPAYMENT").map((e) => e.unitId)).toEqual([null]);
}

describe("JournalEntry.unitId is stamped from the source transaction", () => {
  it("stamps saving, loan, and POS entries with their own unit and leaves a member-credit repayment unit-less", async () => {
    const ledger = await buildLedger();

    expectStamped(ledger, await unitOfEntries(ledger.tenantId));
  });

  it("stamps the scheduler's daily-interest entry with the saving's unit", async () => {
    const admin = await setupTenant();
    const unitA = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const config = await request(app())
      .post("/api/savings/configs")
      .set(bearer(admin.accessToken))
      .send({ name: "Tabungan Harian", type: "SUKARELA", rateType: "BUNGA", rate: 9, periodUnit: "DAILY" }); // 9%/year is the regulatory cap for savings
    const member = await createMemberAs(admin.accessToken);
    await request(app())
      .post("/api/savings")
      .set(bearer(admin.accessToken))
      .send({ memberId: member.id, savingConfigId: config.body.data.id, initialDeposit: 1_000_000 });

    const result = await runDailySavingInterestAccrual(new Date());

    expect(result.posted).toBe(1);
    const interest = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, description: "Bunga simpanan harian" }
    });
    expect(interest.unitId).toBe(unitA.id);
  });
});

describe("the migration's backfill", () => {
  const migration = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../prisma/migrations/20260920100000_journal_entry_unit/migration.sql"
  );

  /** The UPDATEs between the backfill markers — run here exactly as they run in production. */
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

  it("restores each legacy entry's unit from its source row, and leaves manual / repayment entries unit-less", async () => {
    const ledger = await buildLedger();
    await db.journalEntry.create({
      data: { tenantId: ledger.tenantId, entryDate: new Date(), sourceType: "MANUAL", description: "Modal awal", status: "UNPOSTED_MISSING_MAPPING" }
    });
    // Simulate rows written before the column existed.
    await db.$executeRawUnsafe(`UPDATE "JournalEntry" SET "unitId" = NULL WHERE "tenantId" = '${ledger.tenantId}'`);
    expect((await unitOfEntries(ledger.tenantId)).entries.every((e) => e.unitId === null)).toBe(true);

    const statements = backfillStatements();
    expect(statements.length).toBeGreaterThanOrEqual(4); // saving, loan payment, loan disbursement, POS sale
    for (const statement of statements) await db.$executeRawUnsafe(statement);

    const entries = await unitOfEntries(ledger.tenantId);
    expectStamped(ledger, entries);
    expect(entries.byType("MANUAL").map((e) => e.unitId)).toEqual([null]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const ledger = await buildLedger();
    await db.$executeRawUnsafe(`UPDATE "JournalEntry" SET "unitId" = NULL WHERE "tenantId" = '${ledger.tenantId}'`);
    for (const statement of backfillStatements()) await db.$executeRawUnsafe(statement);
    const first = JSON.stringify((await unitOfEntries(ledger.tenantId)).entries.sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId))));

    for (const statement of backfillStatements()) await db.$executeRawUnsafe(statement);

    const second = JSON.stringify((await unitOfEntries(ledger.tenantId)).entries.sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId))));
    expect(second).toBe(first);
  });
});

// ── Per-unit regulatory reports ─────────────────────────────────────────────

interface NeracaBody {
  balanced: boolean;
  aset: { items: Array<{ name: string; balance: string }>; total: string };
  ekuitas: { total: string };
}
interface LabaRugiBody {
  pendapatan: { items: Array<{ name: string; total: string }> };
  beban: { items: Array<{ name: string; total: string }> };
  shuBerjalan: string;
}
interface ArusKasBody {
  balanced: boolean;
  aktivitasOperasi: { rincian: Array<{ label: string; amount: string }> };
}

const neraca = async (s: { accessToken: string }, unitId?: string) =>
  request(app()).get(`/api/reports/regulatory/neraca${unitId ? `?unitId=${unitId}` : ""}`).set(bearer(s.accessToken));
const labaRugi = async (s: { accessToken: string }, unitId?: string) =>
  request(app()).get(`/api/reports/regulatory/laporan-hasil-usaha${unitId ? `?unitId=${unitId}` : ""}`).set(bearer(s.accessToken));
const arusKas = async (s: { accessToken: string }, unitId?: string) =>
  request(app()).get(`/api/reports/regulatory/arus-kas${unitId ? `?unitId=${unitId}` : ""}`).set(bearer(s.accessToken));

const balanceOf = (n: NeracaBody, name: string) => Number(n.aset.items.find((i) => i.name === name)?.balance ?? 0);
const totalOf = (items: Array<{ name: string; total: string }>, name: string) => items.find((i) => i.name === name)?.total;

describe("per-unit Neraca / Laba Rugi / Arus Kas", () => {
  it("cuts Laba Rugi by unit: Toko earns the sales, the savings unit earns nothing", async () => {
    const ledger = await buildLedger();

    const toko = (await labaRugi(ledger.admin, ledger.unitT.id)).body.data as LabaRugiBody;
    const savings = (await labaRugi(ledger.admin, ledger.unitA.id)).body.data as LabaRugiBody;
    const all = (await labaRugi(ledger.admin)).body.data as LabaRugiBody;

    expect(totalOf(toko.pendapatan.items, "Penjualan Barang Dagang")).toBe("75000"); // 45.000 + 30.000
    expect(totalOf(toko.beban.items, "Harga Pokok Penjualan")).toBe("45000"); // 27.000 + 18.000
    expect(toko.shuBerjalan).toBe("30000");
    expect(totalOf(savings.pendapatan.items, "Penjualan Barang Dagang")).toBe("0");
    expect(savings.shuBerjalan).toBe("0");
    expect(totalOf(all.pendapatan.items, "Penjualan Barang Dagang")).toBe("75000");
  });

  it("cuts Neraca by unit, each balanced, and the units plus the unit-less entries add back up to the consolidated Kas", async () => {
    const ledger = await buildLedger();

    const neracaOf = async (unitId?: string) => (await neraca(ledger.admin, unitId)).body.data as NeracaBody;
    const a = await neracaOf(ledger.unitA.id);
    const b = await neracaOf(ledger.unitB.id);
    const t = await neracaOf(ledger.unitT.id);
    const all = await neracaOf();

    expect([a.balanced, b.balanced, t.balanced, all.balanced]).toEqual([true, true, true, true]);
    expect(balanceOf(a, "Kas")).toBe(500_000); // the saving deposit
    expect(balanceOf(b, "Kas")).toBe(-4_900_000); // loan out 5.000.000, 100.000 back
    // Toko: restock 20 x 9.000 paid in cash, then the 45.000 cash sale.
    expect(balanceOf(t, "Kas")).toBe(-135_000);
    expect(balanceOf(t, "Piutang Anggota (Toko)")).toBe(30_000); // the Kredit Anggota sale
    expect(balanceOf(t, "Persediaan Barang Dagang")).toBe(135_000); // bought 180.000, sold 45.000 at cost
    // The 10.000 repayment belongs to no unit: it is exactly what the three units don't account for.
    expect(balanceOf(all, "Kas") - (balanceOf(a, "Kas") + balanceOf(b, "Kas") + balanceOf(t, "Kas"))).toBe(10_000);
  });

  it("cuts Arus Kas by unit with each unit's own activities", async () => {
    const ledger = await buildLedger();

    const labels = async (id: string) => {
      const res = await arusKas(ledger.admin, id);
      expect(res.body.data.balanced).toBe(true);
      return (res.body.data as ArusKasBody).aktivitasOperasi.rincian.map((r) => r.label);
    };

    expect(await labels(ledger.unitA.id)).toEqual(["Setoran/Penarikan Simpanan Anggota"]);
    expect((await labels(ledger.unitB.id)).sort()).toEqual(["Pencairan Pinjaman ke Anggota", "Penerimaan Angsuran Pinjaman"]);
    expect((await labels(ledger.unitT.id)).sort()).toEqual(["Pembelian Persediaan Toko", "Penerimaan Penjualan Toko"]);
  });

  it("still reports a closed (inactive) unit's history", async () => {
    const ledger = await buildLedger();
    await request(app()).put(`/api/config/units/${ledger.unitT.id}`).set(bearer(ledger.admin.accessToken)).send({ isActive: false });

    const res = await labaRugi(ledger.admin, ledger.unitT.id);

    expect(res.status).toBe(200);
    expect((res.body.data as LabaRugiBody).shuBerjalan).toBe("30000");
  });

  it("404s another tenant's unit, 403s a unit outside the caller's assignment, and rejects a malformed id", async () => {
    const ledger = await buildLedger();
    const other = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const otherUnit = await createUnit(other.accessToken, "KONSUMEN", "Toko B");
    const manager = await createStaffSession(ledger.tenantId, "demo", "Manager", "manager@demo.test");
    await db.userUnit.create({ data: { userId: manager.user.id, unitId: ledger.unitA.id } });

    expect((await neraca(ledger.admin, otherUnit.id)).status).toBe(404);
    expect((await neraca(manager, ledger.unitB.id)).status).toBe(403);
    expect((await neraca(manager, ledger.unitA.id)).status).toBe(200);
    expect((await neraca(ledger.admin, "not-a-cuid")).status).toBe(422);
  });
});
