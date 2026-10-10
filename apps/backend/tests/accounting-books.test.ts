import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const OTHER = { slug: "tenant-other", registrationNo: "KOP-OTHER", adminEmail: "admin@other.test" };

async function accounts(tenantId: string) {
  const all = await db.account.findMany({ where: { tenantId } });
  const id = (code: string) => all.find((a) => a.code === code)!.id;
  return {
    kas: id("1-1000"),
    bank: id("1-1010"),
    penyisihan: id("1-1190"),
    asetTetapHeader: id("1-2000"),
    simpananPokok: id("3-1000"),
    pendapatanBunga: id("4-1000"),
    bebanGaji: id("5-2000"),
    bebanPenyisihan: id("5-3000")
  };
}
type Acc = Awaited<ReturnType<typeof accounts>>;

async function journal(
  token: string,
  entryDate: string,
  lines: Array<{ accountId: string; debit?: number; credit?: number }>,
  over: Record<string, unknown> = {}
) {
  const res = await request(app())
    .post("/api/journal")
    .set(bearer(token))
    .send({ entryDate, description: `Jurnal ${entryDate}`, entryType: "UMUM", lines, ...over });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; entryNo: number };
}

const get = (token: string, path: string, query: Record<string, string | number> = {}) =>
  request(app()).get(`/api/reports/accounting${path}`).query(query).set(bearer(token));

/** Modal 1,000,000 (Sep 1), gaji 200,000 (Sep 10), penyisihan adjustment 100,000 (Sep 30), bunga 50,000 (Oct 5). */
async function seedLedger(token: string, a: Acc, unitId?: string) {
  await journal(token, "2026-09-01", [{ accountId: a.kas, debit: 1_000_000 }, { accountId: a.simpananPokok, credit: 1_000_000 }]);
  await journal(token, "2026-09-10", [{ accountId: a.bebanGaji, debit: 200_000 }, { accountId: a.kas, credit: 200_000 }], { unitId });
  await journal(
    token,
    "2026-09-30",
    [{ accountId: a.bebanPenyisihan, debit: 100_000 }, { accountId: a.penyisihan, credit: 100_000 }],
    { entryType: "PENYESUAIAN" }
  );
  await journal(token, "2026-10-05", [{ accountId: a.kas, debit: 50_000 }, { accountId: a.pendapatanBunga, credit: 50_000 }]);
}

describe("GET /api/reports/accounting/jurnal-umum", () => {
  it("lists every ledger line in date order with entry numbers and balanced totals", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);

    const res = await get(admin.accessToken, "/jurnal-umum", { from: "2026-09-01", to: "2026-10-31" });

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.rows).toHaveLength(8);
    expect(d.rows.map((r: { entryDate: string }) => r.entryDate)).toEqual([...d.rows.map((r: { entryDate: string }) => r.entryDate)].sort());
    expect(d.rows[0]).toMatchObject({ entryNo: 1, accountCode: "1-1000", debit: "1000000", credit: "0", entryType: "UMUM", sourceType: "MANUAL" });
    expect(d).toMatchObject({ totalDebit: "1350000", totalCredit: "1350000", balanced: true });
    expect(res.body.meta).toMatchObject({ page: 1, total: 8 });
  });

  it("filters by period using whole business days at both ends", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);
    // 23:30 WIB on the 11th is still before the end of the range, though past UTC midnight arithmetic of a naive end.
    const late = await db.journalEntry.create({
      data: { tenantId: admin.user.tenantId, entryDate: new Date("2026-09-11T16:30:00Z"), sourceType: "MANUAL", description: "Larut malam", entryNo: 99 }
    });
    await db.journalLine.createMany({
      data: [
        { journalEntryId: late.id, tenantId: admin.user.tenantId, accountId: a.kas, debit: 10, credit: 0 },
        { journalEntryId: late.id, tenantId: admin.user.tenantId, accountId: a.pendapatanBunga, debit: 0, credit: 10 }
      ]
    });

    const res = await get(admin.accessToken, "/jurnal-umum", { from: "2026-09-10", to: "2026-09-11" });

    // 09-10 gaji (2 lines) + the 23:30 WIB entry of the 11th, stamped 16:30 UTC (2 lines)
    expect(res.body.data.rows.map((r: { description: string }) => r.description)).toEqual(
      expect.arrayContaining(["Jurnal 2026-09-10", "Larut malam"])
    );
    expect(res.body.data.rows).toHaveLength(4);
  });

  it("filters by entry type and paginates while totals still cover the whole filter", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);

    const adj = await get(admin.accessToken, "/jurnal-umum", { from: "2026-09-01", to: "2026-10-31", type: "PENYESUAIAN" });
    expect(adj.body.data.rows).toHaveLength(2);
    expect(adj.body.data.rows.every((r: { entryType: string }) => r.entryType === "PENYESUAIAN")).toBe(true);

    const page1 = await get(admin.accessToken, "/jurnal-umum", { from: "2026-09-01", to: "2026-10-31", limit: 3, page: 1 });
    const page3 = await get(admin.accessToken, "/jurnal-umum", { from: "2026-09-01", to: "2026-10-31", limit: 3, page: 3 });
    expect(page1.body.data.rows).toHaveLength(3);
    expect(page3.body.data.rows).toHaveLength(2);
    expect(page1.body.meta.total).toBe(8);
    expect(page1.body.data.totalDebit).toBe("1350000");
  });

  it("cuts to a unit, to the unallocated bucket, and the pieces add back to the consolidated figure", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    await seedLedger(admin.accessToken, a, unit.id);
    const q = { from: "2026-09-01", to: "2026-10-31" };

    const all = await get(admin.accessToken, "/jurnal-umum", q);
    const forUnit = await get(admin.accessToken, "/jurnal-umum", { ...q, unitId: unit.id });
    const unallocated = await get(admin.accessToken, "/jurnal-umum", { ...q, unitId: "unallocated" });

    expect(forUnit.body.data.rows).toHaveLength(2);
    expect(unallocated.body.data.rows).toHaveLength(6);
    expect(Number(forUnit.body.data.totalDebit) + Number(unallocated.body.data.totalDebit)).toBe(Number(all.body.data.totalDebit));
  });

  it("404s another tenant's unit, ignores another tenant's data, and rejects end before start", async () => {
    const admin = await setupTenant();
    const other = await setupTenant(OTHER);
    await seedLedger(other.accessToken, await accounts(other.user.tenantId));
    const foreignUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: other.user.tenantId } });

    const mine = await get(admin.accessToken, "/jurnal-umum", { from: "2026-09-01", to: "2026-10-31" });
    const cross = await get(admin.accessToken, "/jurnal-umum", { unitId: foreignUnit.id });
    const reversed = await get(admin.accessToken, "/jurnal-umum", { from: "2026-10-31", to: "2026-09-01" });

    expect(mine.body.data.rows).toHaveLength(0);
    expect(cross.status).toBe(404);
    expect(reversed.status).toBe(422);
  });

  it("is gated on the accounting package and on reports:read", async () => {
    const free = await setupTenant({}, { entitled: false });
    const entitled = await setupTenant(OTHER);
    const kasir = await createStaffSession(entitled.user.tenantId, "tenant-other", "Kasir", "kasir@other.test");

    expect((await get(free.accessToken, "/jurnal-umum")).status).toBe(403);
    expect((await get(kasir.accessToken, "/jurnal-umum")).status).toBe(403);
  });
});

describe("GET /api/reports/accounting/jurnal-penyesuaian", () => {
  it("lists only adjusting entries", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);

    const res = await get(admin.accessToken, "/jurnal-penyesuaian", { from: "2026-09-01", to: "2026-10-31" });

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows.map((r: { accountCode: string }) => r.accountCode).sort()).toEqual(["1-1190", "5-3000"]);
    expect(res.body.data.balanced).toBe(true);
  });
});

describe("GET /api/reports/accounting/neraca-saldo", () => {
  it("shows opening, movement and closing per account and balances", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);

    const res = await get(admin.accessToken, "/neraca-saldo", { from: "2026-10-01", to: "2026-10-31" });

    expect(res.status).toBe(200);
    const row = (code: string) => res.body.data.rows.find((r: { code: string }) => r.code === code);
    // Kas: 1,000,000 - 200,000 before October, +50,000 in October
    expect(row("1-1000")).toMatchObject({ saldoAwal: "800000", mutasiDebit: "50000", mutasiKredit: "0", saldoAkhir: "850000" });
    // Penyisihan is credit-normal: shown on its own side, never netted into Aset here.
    expect(row("1-1190")).toMatchObject({ normalBalance: "KREDIT", isContra: true, saldoAwal: "100000", saldoAkhir: "100000" });
    expect(row("4-1000")).toMatchObject({ saldoAwal: "0", mutasiKredit: "50000", saldoAkhir: "50000" });
    expect(res.body.data.totals.mutasiDebit).toBe(res.body.data.totals.mutasiKredit);
    expect(res.body.data.totals.saldoAkhirDebit).toBe(res.body.data.totals.saldoAkhirKredit);
    expect(res.body.data.balanced).toBe(true);
  });

  it("rolls headers up from their children without double counting the totals", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    const tetap = await db.account.create({
      data: { tenantId: admin.user.tenantId, code: "1-2100", name: "Peralatan", category: "ASET", normalBalance: "DEBIT", parentId: a.asetTetapHeader }
    });
    await journal(admin.accessToken, "2026-09-02", [{ accountId: tetap.id, debit: 300_000 }, { accountId: a.kas, credit: 300_000 }]);
    await journal(admin.accessToken, "2026-09-01", [{ accountId: a.kas, debit: 300_000 }, { accountId: a.simpananPokok, credit: 300_000 }]);

    const res = await get(admin.accessToken, "/neraca-saldo", { from: "2026-09-01", to: "2026-09-30" });

    const header = res.body.data.rows.find((r: { code: string }) => r.code === "1-2000");
    const child = res.body.data.rows.find((r: { code: string }) => r.code === "1-2100");
    expect(header).toMatchObject({ isHeader: true, level: 1, mutasiDebit: "300000", saldoAkhir: "300000" });
    expect(child).toMatchObject({ level: 2, parentId: a.asetTetapHeader });
    // child listed right after its header
    const codes = res.body.data.rows.map((r: { code: string }) => r.code);
    expect(codes.indexOf("1-2100")).toBe(codes.indexOf("1-2000") + 1);
    // 600,000 total debit movement, not 900,000
    expect(res.body.data.totals.mutasiDebit).toBe("600000");
  });

  it("sums per-unit and unallocated figures back to the consolidated trial balance", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    await seedLedger(admin.accessToken, a, unit.id);
    const q = { from: "2026-09-01", to: "2026-10-31" };

    const all = await get(admin.accessToken, "/neraca-saldo", q);
    const forUnit = await get(admin.accessToken, "/neraca-saldo", { ...q, unitId: unit.id });
    const unallocated = await get(admin.accessToken, "/neraca-saldo", { ...q, unitId: "unallocated" });

    const kas = (r: { body: { data: { rows: Array<{ code: string; saldoAkhir: string }> } } }) =>
      Number(r.body.data.rows.find((x) => x.code === "1-1000")!.saldoAkhir);
    expect(kas(forUnit) + kas(unallocated)).toBe(kas(all));
    expect(kas(forUnit)).toBe(-200_000);
  });
});

describe("GET /api/reports/accounting/buku-besar", () => {
  it("lists only accounts with a balance or movement", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);

    const res = await get(admin.accessToken, "/buku-besar", { from: "2026-09-01", to: "2026-10-31" });

    const codes = res.body.data.rows.map((r: { code: string }) => r.code);
    expect(codes).toContain("1-1000");
    expect(codes).not.toContain("1-1010"); // Bank never used
  });
});

describe("GET /api/reports/accounting/buku-besar/:accountId", () => {
  it("shows opening balance, each line with a running balance, and the closing balance", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);
    await journal(admin.accessToken, "2026-10-20", [{ accountId: a.kas, credit: 25_000 }, { accountId: a.bebanGaji, debit: 25_000 }]);

    const res = await get(admin.accessToken, `/buku-besar/${a.kas}`, { from: "2026-10-01", to: "2026-10-31" });

    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.account).toMatchObject({ code: "1-1000", normalBalance: "DEBIT" });
    expect(d.saldoAwal).toBe("800000");
    expect(d.lines.map((l: { saldo: string }) => l.saldo)).toEqual(["850000", "825000"]);
    expect(d).toMatchObject({ totalDebit: "50000", totalCredit: "25000", saldoAkhir: "825000" });
    expect(d.lines[0]).toMatchObject({ entryNo: 4, debit: "50000", credit: "0" });
  });

  it("keeps the running balance continuous across pages and signs it by normal side", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);
    for (const day of ["10", "11", "12"]) {
      await journal(admin.accessToken, `2026-10-${day}`, [{ accountId: a.kas, debit: 1_000 }, { accountId: a.pendapatanBunga, credit: 1_000 }]);
    }
    const q = { from: "2026-10-01", to: "2026-10-31", limit: 2 };

    const p1 = await get(admin.accessToken, `/buku-besar/${a.kas}`, { ...q, page: 1 });
    const p2 = await get(admin.accessToken, `/buku-besar/${a.kas}`, { ...q, page: 2 });

    expect(p1.body.data.lines.map((l: { saldo: string }) => l.saldo)).toEqual(["850000", "851000"]);
    expect(p2.body.data.lines.map((l: { saldo: string }) => l.saldo)).toEqual(["852000", "853000"]);
    expect(p2.body.data.saldoAkhir).toBe("853000");
    expect(p1.body.meta).toMatchObject({ total: 4, page: 1, limit: 2 });

    const penyisihan = await get(admin.accessToken, `/buku-besar/${a.penyisihan}`, { from: "2026-09-01", to: "2026-09-30" });
    expect(penyisihan.body.data.lines[0]).toMatchObject({ credit: "100000", saldo: "100000" }); // credit-normal: credit raises it
  });

  it("422s a header account and 404s an unknown or foreign account", async () => {
    const admin = await setupTenant();
    const other = await setupTenant(OTHER);
    const a = await accounts(admin.user.tenantId);
    const foreign = await accounts(other.user.tenantId);

    const header = await get(admin.accessToken, `/buku-besar/${a.asetTetapHeader}`);
    const cross = await get(admin.accessToken, `/buku-besar/${foreign.kas}`);

    expect(header.status).toBe(422);
    expect(cross.status).toBe(404);
  });
});
