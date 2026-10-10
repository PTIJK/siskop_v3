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

// The year being closed must be a completed one, so everything is relative to today.
const THIS_YEAR = new Date().getFullYear();
const Y = THIS_YEAR - 1; // the year closed in most tests
const d = (year: number, md: string) => `${year}-${md}`;

async function accounts(tenantId: string) {
  const all = await db.account.findMany({ where: { tenantId } });
  const id = (code: string) => all.find((a) => a.code === code)!.id;
  return {
    kas: id("1-1000"),
    simpananPokok: id("3-1000"),
    shuLalu: id("3-3100"),
    pendapatanBunga: id("4-1000"),
    bebanGaji: id("5-2000")
  };
}
type Acc = Awaited<ReturnType<typeof accounts>>;

function journal(
  token: string,
  entryDate: string,
  lines: Array<{ accountId: string; debit?: number; credit?: number }>,
  over: Record<string, unknown> = {}
) {
  return request(app())
    .post("/api/journal")
    .set(bearer(token))
    .send({ entryDate, description: `Jurnal ${entryDate}`, entryType: "UMUM", lines, ...over });
}

/** Year Y: modal 1,000,000; bunga 300,000; gaji 100,000 (optionally booked to a unit). SHU = 200,000. */
async function seedYear(token: string, a: Acc, year: number, unitId?: string) {
  for (const res of [
    await journal(token, d(year, "01-05"), [{ accountId: a.kas, debit: 1_000_000 }, { accountId: a.simpananPokok, credit: 1_000_000 }]),
    await journal(token, d(year, "06-01"), [{ accountId: a.kas, debit: 300_000 }, { accountId: a.pendapatanBunga, credit: 300_000 }]),
    await journal(token, d(year, "07-01"), [{ accountId: a.bebanGaji, debit: 100_000 }, { accountId: a.kas, credit: 100_000 }], { unitId })
  ]) {
    expect(res.status).toBe(201);
  }
}

const close = (token: string, year: number, body: Record<string, unknown> = {}) =>
  request(app()).post(`/api/journal/year-close/${year}`).set(bearer(token)).send(body);
const reopen = (token: string, year: number) => request(app()).post(`/api/journal/year-close/${year}/reopen`).set(bearer(token)).send({});
const preview = (token: string, year: number) => request(app()).get(`/api/journal/year-close/${year}/preview`).set(bearer(token));
const report = (token: string, path: string, query: Record<string, string | number>) =>
  request(app()).get(`/api/reports${path}`).query(query).set(bearer(token));

describe("year-close preview", () => {
  it("plans one balanced closing entry that zeroes income and expense into SHU Tahun Lalu, without writing anything", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y);

    const res = await preview(admin.accessToken, Y);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ year: Y, netIncome: "200000", targetAccount: { code: "3-3100" } });
    expect(res.body.data.entries).toHaveLength(1);
    const lines = res.body.data.entries[0].lines as Array<{ accountCode: string; debit: string; credit: string }>;
    const byCode = Object.fromEntries(lines.map((l) => [l.accountCode, l]));
    expect(byCode["4-1000"]).toMatchObject({ debit: "300000", credit: "0" });
    expect(byCode["5-2000"]).toMatchObject({ debit: "0", credit: "100000" });
    expect(byCode["3-3100"]).toMatchObject({ debit: "0", credit: "200000" });
    expect(await db.journalEntry.count({ where: { tenantId: admin.user.tenantId, entryType: "PENUTUP" } })).toBe(0);
  });
});

describe("POST /api/journal/year-close/:year", () => {
  it("posts PENUTUP entries so the next year opens with zeroed income and expense", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y);

    const res = await close(admin.accessToken, Y);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ year: Y, netIncome: "200000", status: "CLOSED" });
    const entries = await db.journalEntry.findMany({ where: { tenantId: admin.user.tenantId, entryType: "PENUTUP" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sourceType: "CLOSING", unitId: null });
    expect(entries[0]!.entryNo).toBe(4);

    const tb = await report(admin.accessToken, "/accounting/neraca-saldo", { from: d(THIS_YEAR, "01-01"), to: d(THIS_YEAR, "01-31") });
    const row = (code: string) => tb.body.data.rows.find((r: { code: string }) => r.code === code);
    expect(row("4-1000").saldoAwal).toBe("0");
    expect(row("5-2000").saldoAwal).toBe("0");
    expect(row("3-3100").saldoAwal).toBe("200000");
    expect(tb.body.data.balanced).toBe(true);

    const neraca = await report(admin.accessToken, "/regulatory/neraca", { asOfDate: d(THIS_YEAR, "01-31") });
    expect(neraca.body.data.balanced).toBe(true);
    const unclosed = neraca.body.data.ekuitas.items.find((i: { isComputed: boolean }) => i.isComputed);
    expect(unclosed.balance).toBe("0"); // nothing left unclosed
    expect(neraca.body.data.ekuitas.total).toBe("1200000");
  });

  it("keeps the closed year's income statement and equity statement showing the year's real activity", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y);
    await close(admin.accessToken, Y);
    const period = { from: d(Y, "01-01"), to: d(Y, "12-31") };

    const lr = await report(admin.accessToken, "/regulatory/laporan-hasil-usaha", period);
    const pe = await report(admin.accessToken, "/regulatory/perubahan-ekuitas", period);

    expect(lr.body.data.pendapatan.total).toBe("300000");
    expect(lr.body.data.beban.total).toBe("100000");
    expect(lr.body.data.shuBerjalan).toBe("200000");
    const row = (key: string) => pe.body.data.rows.find((r: { key: string }) => r.key === key);
    expect(row("SHU_PERIODE_BERJALAN").values.SHU).toBe("200000");
    expect(row("PENAMBAHAN").values.SHU).toBe("0"); // the transfer is not double counted as an addition
    expect(row("SALDO_AKHIR").total).toBe("1200000");
  });

  it("books one closing entry per unit and the unit pieces add back to the consolidated income", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    await seedYear(admin.accessToken, a, Y, unit.id);

    const res = await close(admin.accessToken, Y);

    expect(res.status).toBe(201);
    const entries = await db.journalEntry.findMany({ where: { tenantId: admin.user.tenantId, entryType: "PENUTUP" } });
    expect(entries.map((e) => e.unitId).sort()).toEqual([null, unit.id].sort());
    expect(res.body.data.entries.reduce((s: number, e: { netIncome: string }) => s + Number(e.netIncome), 0)).toBe(200_000);
    // the unit lost 100,000 (gaji), the unallocated bucket earned 300,000
    const byUnit = Object.fromEntries(res.body.data.entries.map((e: { unitId: string | null; netIncome: string }) => [String(e.unitId), e.netIncome]));
    expect(byUnit[unit.id]).toBe("-100000");
    expect(byUnit["null"]).toBe("300000");
  });

  it("refuses the current year, a year already closed, and a year with unposted entries", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y);

    expect((await close(admin.accessToken, THIS_YEAR)).status).toBe(422);
    expect((await close(admin.accessToken, Y)).status).toBe(201);
    expect((await close(admin.accessToken, Y)).status).toBe(409);

    await db.journalEntry.create({
      data: { tenantId: admin.user.tenantId, entryDate: new Date(d(Y - 1, "03-01")), sourceType: "POS_SALE", description: "Belum terposting", status: "UNPOSTED_MISSING_MAPPING" }
    });
    const blocked = await close(admin.accessToken, Y - 1);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/belum terposting/i);
  });

  it("needs a target equity account: 422 when SHU Tahun Lalu is gone, accepts an explicit one, 404 for a foreign one", async () => {
    const admin = await setupTenant();
    const other = await setupTenant(OTHER);
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y);
    await db.account.updateMany({ where: { id: a.shuLalu, tenantId: admin.user.tenantId }, data: { code: "3-3199" } });

    const missing = await close(admin.accessToken, Y);
    const foreign = await close(admin.accessToken, Y, { targetAccountId: (await accounts(other.user.tenantId)).shuLalu });
    const notEquity = await close(admin.accessToken, Y, { targetAccountId: a.kas });
    const ok = await close(admin.accessToken, Y, { targetAccountId: a.shuLalu });

    expect(missing.status).toBe(422);
    expect(foreign.status).toBe(404);
    expect(notEquity.status).toBe(422);
    expect(ok.status).toBe(201);
    expect(ok.body.data.targetAccount.code).toBe("3-3199");
  });

  it("closes a year with no income or expense without posting anything", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await journal(admin.accessToken, d(Y, "01-05"), [{ accountId: a.kas, debit: 10 }, { accountId: a.simpananPokok, credit: 10 }]);

    const res = await close(admin.accessToken, Y);

    expect(res.status).toBe(201);
    expect(res.body.data.entries).toHaveLength(0);
    expect(await db.journalEntry.count({ where: { tenantId: admin.user.tenantId, entryType: "PENUTUP" } })).toBe(0);
  });

  it("is limited to roles with accounting:update, and to the accounting package", async () => {
    const admin = await setupTenant();
    const free = await setupTenant(OTHER, { entitled: false });
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "mgr@demo.test");

    expect((await close(manager.accessToken, Y)).status).toBe(403);
    expect((await close(free.accessToken, Y)).status).toBe(403);
  });
});

describe("closed years are locked for manual journals", () => {
  it("rejects a manual entry and a reversal dated in a closed year, and allows them once reopened", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y);
    const spare = await journal(admin.accessToken, d(Y, "08-01"), [{ accountId: a.kas, debit: 5 }, { accountId: a.simpananPokok, credit: 5 }]);
    await close(admin.accessToken, Y);
    const entry = [{ accountId: a.kas, debit: 1 }, { accountId: a.simpananPokok, credit: 1 }];

    const blocked = await journal(admin.accessToken, d(Y, "12-30"), entry);
    const blockedReverse = await request(app())
      .post(`/api/journal/${spare.body.data.id}/reverse`)
      .set(bearer(admin.accessToken))
      .send({ entryDate: d(Y, "12-30") });
    expect(blocked.status).toBe(409);
    expect(blockedReverse.status).toBe(409);
    // a date in the open year is fine
    expect((await journal(admin.accessToken, d(THIS_YEAR, "01-02"), entry)).status).toBe(201);

    expect((await reopen(admin.accessToken, Y)).status).toBe(200);
    expect((await journal(admin.accessToken, d(Y, "12-30"), entry)).status).toBe(201);
  });
});

describe("POST /api/journal/year-close/:year/reopen", () => {
  it("reverses the closing entries so the year reads as unclosed, and allows closing again", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y);
    await close(admin.accessToken, Y);

    const res = await reopen(admin.accessToken, Y);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REOPENED");
    const tb = await report(admin.accessToken, "/accounting/neraca-saldo", { from: d(THIS_YEAR, "01-01"), to: d(THIS_YEAR, "01-31") });
    const row = (code: string) => tb.body.data.rows.find((r: { code: string }) => r.code === code);
    expect(row("4-1000").saldoAwal).toBe("300000"); // income is back, unclosed
    expect(row("3-3100").saldoAwal).toBe("0");
    expect(tb.body.data.balanced).toBe(true);

    const again = await close(admin.accessToken, Y);
    expect(again.status).toBe(201);
    const tb2 = await report(admin.accessToken, "/accounting/neraca-saldo", { from: d(THIS_YEAR, "01-01"), to: d(THIS_YEAR, "01-31") });
    expect(tb2.body.data.rows.find((r: { code: string }) => r.code === "3-3100").saldoAwal).toBe("200000");
  });

  it("404s a year that was never closed, 409s one already reopened, and 409s while a later year is closed", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y - 1);
    await seedYear(admin.accessToken, a, Y);

    expect((await reopen(admin.accessToken, Y)).status).toBe(404);
    await close(admin.accessToken, Y - 1);
    await close(admin.accessToken, Y);
    const blocked = await reopen(admin.accessToken, Y - 1);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/lebih baru/i);

    await reopen(admin.accessToken, Y);
    expect((await reopen(admin.accessToken, Y)).status).toBe(409);
    expect((await reopen(admin.accessToken, Y - 1)).status).toBe(200);
  });
});

describe("GET /api/journal/year-close", () => {
  it("lists every completed year with entries and its close status", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedYear(admin.accessToken, a, Y - 1);
    await seedYear(admin.accessToken, a, Y);
    await close(admin.accessToken, Y - 1);

    const res = await request(app()).get("/api/journal/year-close").set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.currentYear).toBe(THIS_YEAR);
    expect(res.body.data.years).toEqual([
      expect.objectContaining({ year: Y, status: "OPEN" }),
      expect.objectContaining({ year: Y - 1, status: "CLOSED" })
    ]);
  });

  it("never shows another tenant's closes", async () => {
    const admin = await setupTenant();
    const other = await setupTenant(OTHER);
    const a = await accounts(other.user.tenantId);
    await seedYear(other.accessToken, a, Y);
    await close(other.accessToken, Y);

    const res = await request(app()).get("/api/journal/year-close").set(bearer(admin.accessToken));

    expect(res.body.data.years).toEqual([]);
  });
});
