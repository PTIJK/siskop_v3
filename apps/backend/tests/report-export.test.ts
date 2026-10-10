import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import ExcelJS from "exceljs";
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
    penyisihan: id("1-1190"),
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
}

/** Modal 1,000,000 (Sep 1); gaji 200,000 (Sep 10); penyisihan 100,000 adjustment (Sep 30); bunga 50,000 (Oct 5). */
async function seedLedger(token: string, a: Acc) {
  await journal(token, "2026-09-01", [{ accountId: a.kas, debit: 1_000_000 }, { accountId: a.simpananPokok, credit: 1_000_000 }]);
  await journal(token, "2026-09-10", [{ accountId: a.bebanGaji, debit: 200_000 }, { accountId: a.kas, credit: 200_000 }]);
  await journal(token, "2026-09-30", [{ accountId: a.bebanPenyisihan, debit: 100_000 }, { accountId: a.penyisihan, credit: 100_000 }], {
    entryType: "PENYESUAIAN"
  });
  await journal(token, "2026-10-05", [{ accountId: a.kas, debit: 50_000 }, { accountId: a.pendapatanBunga, credit: 50_000 }]);
}

const exportReq = (token: string, report: string, query: Record<string, string | number> = {}) =>
  request(app())
    .get(`/api/reports/export/${report}`)
    .query(query)
    .set(bearer(token))
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

async function workbookOf(body: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body);
  return wb;
}

/** All cell values of a sheet as rows of plain values, for assertions. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => out.push((row.values as unknown[]).slice(1)));
  return out;
}

const PERIOD = { from: "2026-09-01", to: "2026-10-31" };

describe("CSV export", () => {
  it("downloads Jurnal Umum with a BOM, a title block, every row (not just a page) and plain decimal amounts", async () => {
    const admin = await setupTenant();
    await seedLedger(admin.accessToken, await accounts(admin.user.tenantId));

    const res = await exportReq(admin.accessToken, "jurnal-umum", { format: "csv", ...PERIOD });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toContain('attachment; filename="jurnal-umum-2026-09-01_2026-10-31.csv"');
    const text = (res.body as Buffer).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("KSP Demo");
    expect(lines[1]).toBe("Jurnal Umum");
    expect(lines[2]).toContain("1 September 2026");
    const header = lines.findIndex((l) => l.startsWith("No,Tanggal,Kode"));
    expect(header).toBeGreaterThan(0);
    // 4 entries x 2 lines + the total row
    expect(lines.slice(header + 1)).toHaveLength(9);
    expect(lines[header + 1]).toBe("1,2026-09-01,1-1000,Kas,Jurnal 2026-09-01,UMUM,MANUAL,1000000.00,0.00");
    expect(lines[lines.length - 1]).toMatch(/^,,,,Total,,,1350000\.00,1350000\.00$/);
  });

  it("defuses spreadsheet formulas in free text but leaves negative amounts alone", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await journal(admin.accessToken, "2026-09-01", [{ accountId: a.kas, debit: 10 }, { accountId: a.simpananPokok, credit: 10 }], {
      description: '=HYPERLINK("http://evil","klik")'
    });
    await journal(admin.accessToken, "2026-09-02", [{ accountId: a.bebanGaji, debit: 10 }, { accountId: a.kas, credit: 10 }]);

    const jurnal = (await exportReq(admin.accessToken, "jurnal-umum", { format: "csv", ...PERIOD })).body.toString("utf8");
    const ledger = (await exportReq(admin.accessToken, "buku-besar", { format: "csv", accountId: a.kas, ...PERIOD })).body.toString("utf8");

    expect(jurnal).toContain(`"'=HYPERLINK(""http://evil"",""klik"")"`);
    expect(ledger).toMatch(/,-?\d+\.\d\d\r\n/); // running balance column stays numeric
    expect(ledger).not.toContain("'-");
  });
});

describe("XLSX export", () => {
  it("writes Neraca Saldo as a workbook with a real number per amount, bold totals and a title", async () => {
    const admin = await setupTenant();
    await seedLedger(admin.accessToken, await accounts(admin.user.tenantId));

    const res = await exportReq(admin.accessToken, "neraca-saldo", { format: "xlsx", from: "2026-10-01", to: "2026-10-31" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toContain("neraca-saldo-2026-10-01_2026-10-31.xlsx");
    const wb = await workbookOf(res.body as Buffer);
    const ws = wb.worksheets[0]!;
    const rows = rowsOf(ws);
    expect(rows[0]![0]).toBe("KSP Demo");
    expect(rows[1]![0]).toBe("Neraca Saldo");
    const kas = rows.find((r) => r[0] === "1-1000")!;
    // Kode, Nama, Saldo Awal (carried from September), Debit, Kredit, Saldo Akhir: numbers, not strings
    expect(kas.slice(2)).toEqual([800_000, 50_000, 0, 850_000]);
    const total = rows.find((r) => r[1] === "Total")!;
    expect(total.slice(2, 5)).toEqual([undefined, 50_000, 50_000]);
    // row numbers count the blank spacer row that rowsOf skips, so look the row up by its label
    let boldTotal = false;
    ws.eachRow((row) => {
      if (row.getCell(2).value === "Total") boldTotal = row.getCell(2).font?.bold === true;
    });
    expect(boldTotal).toBe(true);
  });

  it("exports the statements with sections, subtotals and the SHU line", async () => {
    const admin = await setupTenant();
    await seedLedger(admin.accessToken, await accounts(admin.user.tenantId));

    const neraca = await workbookOf((await exportReq(admin.accessToken, "neraca", { format: "xlsx", asOfDate: "2026-10-31" })).body);
    const nRows = rowsOf(neraca.worksheets[0]!);
    expect(nRows.some((r) => r[1] === "Total Aset" && r[2] === 750_000)).toBe(true); // 850,000 Kas - 100,000 allowance
    expect(nRows.some((r) => r[1] === "Total Kewajiban dan Ekuitas" && r[2] === 750_000)).toBe(true);

    const hu = await workbookOf((await exportReq(admin.accessToken, "laporan-hasil-usaha", { format: "xlsx", ...PERIOD })).body);
    const hRows = rowsOf(hu.worksheets[0]!);
    expect(hRows.some((r) => r[1] === "Total Pendapatan" && r[2] === 50_000)).toBe(true);
    expect(hRows.some((r) => r[1] === "Total Beban" && r[2] === 300_000)).toBe(true);
    expect(hRows.some((r) => String(r[1]).startsWith("SHU Berjalan") && r[2] === -250_000)).toBe(true);
  });

  it("exports Arus Kas, Perubahan Ekuitas and Pembagian SHU", async () => {
    const admin = await setupTenant();
    await seedLedger(admin.accessToken, await accounts(admin.user.tenantId));

    const kas = rowsOf((await workbookOf((await exportReq(admin.accessToken, "arus-kas", { format: "xlsx", ...PERIOD })).body)).worksheets[0]!);
    expect(kas.some((r) => r[0] === "Saldo Kas Akhir" && r[1] === 850_000)).toBe(true);

    const pe = rowsOf((await workbookOf((await exportReq(admin.accessToken, "perubahan-ekuitas", { format: "xlsx", ...PERIOD })).body)).worksheets[0]!);
    const header = pe.find((r) => r[0] === "Keterangan")!;
    expect(header[header.length - 1]).toBe("Total");
    expect(pe.some((r) => r[0] === "Saldo akhir")).toBe(true);

    const shu = await exportReq(admin.accessToken, "shu-distribution", { format: "csv", ...PERIOD });
    expect(shu.status).toBe(200); // not configured: the sheet carries the guidance instead of failing
    expect(shu.body.toString("utf8")).toMatch(/Konfigurasi|konfigurasi|belum/i);
  });

  it("exports one account's ledger with the running balance", async () => {
    const admin = await setupTenant();
    const a = await accounts(admin.user.tenantId);
    await seedLedger(admin.accessToken, a);

    const res = await exportReq(admin.accessToken, "buku-besar", { format: "xlsx", accountId: a.kas, ...PERIOD });

    const rows = rowsOf((await workbookOf(res.body as Buffer)).worksheets[0]!);
    const saldo = rows.filter((r) => typeof r[5] === "number").map((r) => r[5]);
    expect(saldo).toEqual([0, 1_000_000, 800_000, 850_000, 850_000]); // opening, 3 lines, closing
  });
});

describe("export access", () => {
  it("requires the accounting package and reports:export", async () => {
    const free = await setupTenant({}, { entitled: false });
    const entitled = await setupTenant(OTHER);
    const viewer = await createStaffSession(entitled.user.tenantId, "tenant-other", "Viewer", "viewer@other.test");

    expect((await exportReq(free.accessToken, "neraca", { format: "csv" })).status).toBe(403);
    expect((await exportReq(viewer.accessToken, "neraca", { format: "csv" })).status).toBe(403);
  });

  it("rejects an unknown report, a missing or unknown format, and a reversed period", async () => {
    const admin = await setupTenant();

    expect((await exportReq(admin.accessToken, "gaji-karyawan", { format: "csv" })).status).toBe(404);
    expect((await exportReq(admin.accessToken, "neraca", {})).status).toBe(422);
    expect((await exportReq(admin.accessToken, "neraca", { format: "docx" })).status).toBe(422);
    expect((await exportReq(admin.accessToken, "jurnal-umum", { format: "csv", from: "2026-10-31", to: "2026-09-01" })).status).toBe(422);
  });

  it("scopes to the caller's tenant and checks the unit like the on-screen report", async () => {
    const admin = await setupTenant();
    const other = await setupTenant(OTHER);
    await seedLedger(other.accessToken, await accounts(other.user.tenantId));
    const foreignUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: other.user.tenantId } });
    const ownUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    const mine = await exportReq(admin.accessToken, "jurnal-umum", { format: "csv", ...PERIOD });
    const cross = await exportReq(admin.accessToken, "jurnal-umum", { format: "csv", unitId: foreignUnit.id });
    const own = await exportReq(admin.accessToken, "jurnal-umum", { format: "csv", unitId: ownUnit.id, ...PERIOD });

    expect(mine.body.toString("utf8")).not.toContain("Jurnal 2026-09-01");
    expect(cross.status).toBe(404);
    expect(own.body.toString("utf8")).toContain(ownUnit.name);
  });

  it("refuses the unallocated bucket for the statements, which have no such view", async () => {
    const admin = await setupTenant();

    const res = await exportReq(admin.accessToken, "neraca", { format: "csv", unitId: "unallocated" });

    expect(res.status).toBe(422);
  });
});
