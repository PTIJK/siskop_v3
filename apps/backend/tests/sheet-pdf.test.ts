import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import type { ExportSheet } from "../src/modules/reports/export.js";
import { escapeHtml, sheetBodyHtml, sheetPageHtml, withPrintedBy } from "../src/modules/reports/pdf.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

const sheet: ExportSheet = {
  name: "Neraca Saldo",
  tenantName: "KSP Demo",
  title: "Neraca Saldo",
  subtitle: "1 Oktober 2026 s/d 31 Oktober 2026 · Semua unit (konsolidasi)",
  columns: [
    { key: "code", header: "Kode", kind: "text" },
    { key: "name", header: "Nama Akun", kind: "text" },
    { key: "amount", header: "Saldo", kind: "money" }
  ],
  rows: [
    { cells: { code: "1-2000", name: "Aset Tetap", amount: "10800000" }, style: "subtotal", indent: 0 },
    { cells: { code: "1-2100", name: "Peralatan <b>Kantor</b>", amount: "12000000" }, indent: 1 },
    { cells: { code: "1-2190", name: "Akumulasi", amount: "0" }, indent: 1 },
    { cells: { name: "Total", amount: "1234.5" }, style: "total" }
  ]
};

describe("sheetBodyHtml", () => {
  const html = sheetBodyHtml(sheet);

  it("right-aligns money, shows a dash for zero and keeps decimals only when there are any", () => {
    expect(html).toContain('<td style="text-align:right; white-space:nowrap">10.800.000</td>');
    expect(html).toContain('<td style="text-align:right; white-space:nowrap">-</td>');
    expect(html).toContain("1.234,5");
  });

  it("makes group rows bold, total rows a total row, and indents the name column by depth but not the code", () => {
    expect(html).toContain('<tr style="font-weight:bold">');
    expect(html).toContain('<tr class="total">');
    expect(html).toMatch(/<td>1-2100<\/td><td style="padding-left:22px">/); // depth 1 -> 8 + 14
    expect(html).toMatch(/<td>1-2000<\/td><td>Aset Tetap<\/td>/); // depth 0: no indent
  });

  it("escapes user text so an account name cannot inject markup into the page the browser renders", () => {
    expect(html).toContain("Peralatan &lt;b&gt;Kantor&lt;/b&gt;");
    expect(html).not.toContain("<b>Kantor</b>");
    expect(escapeHtml(`"<&>'`)).toBe("&quot;&lt;&amp;&gt;&#39;");
  });
});

describe("sheetPageHtml", () => {
  const tenant = { name: "KSP <Demo>", address: "Jl. Demo 1, Surabaya, Jawa Timur", registrationNo: "KOP-1" };

  it("carries the tenant, title, period, who printed it and, on request, the signature block", async () => {
    const html = await withPrintedBy("Rina <Admin>", async () => sheetPageHtml(tenant, sheet, { signature: true }));

    expect(html).toContain("KSP &lt;Demo&gt;");
    expect(html).toContain("Neraca Saldo");
    expect(html).toContain("1 Oktober 2026 s/d 31 Oktober 2026");
    expect(html).toMatch(/Dicetak pada .* WIB oleh Rina &lt;Admin&gt;/);
    expect(html).toContain("Ketua,");
    expect(html).toContain("Bendahara,");
  });

  it("omits the signature block unless asked, and the name when nobody is signed in", () => {
    const html = sheetPageHtml(tenant, sheet);

    expect(html).not.toContain("Bendahara,");
    expect(html).toMatch(/Dicetak pada [^<]*WIB<\/p>/);
    expect(html).not.toContain(" oleh ");
  });
});

describe("PDF through the export endpoint", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  });
  beforeEach(async () => {
    await db.tenant.deleteMany({});
  });

  const pdfOf = (token: string, report: string, query: Record<string, string> = {}) =>
    request(app())
      .get(`/api/reports/export/${report}`)
      .query({ format: "pdf", from: "2026-09-01", to: "2026-10-31", ...query })
      .set({ Authorization: `Bearer ${token}` })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  it("renders Jurnal Umum, Neraca Saldo and Buku Besar as real PDFs", async () => {
    const admin = await setupTenant();
    const kas = (await db.account.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, code: "1-1000" } })).id;
    const modal = (await db.account.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, code: "3-1000" } })).id;
    await request(app())
      .post("/api/journal")
      .set({ Authorization: `Bearer ${admin.accessToken}` })
      .send({ entryDate: "2026-09-01", description: "Modal", entryType: "UMUM", lines: [{ accountId: kas, debit: 1000 }, { accountId: modal, credit: 1000 }] });

    for (const [report, extra] of [["jurnal-umum", {}], ["neraca-saldo", {}], ["buku-besar", { accountId: kas }]] as const) {
      const res = await pdfOf(admin.accessToken, report, extra);
      expect(res.status, report).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain(`${report}`);
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    }
  }, 60_000);

  it("keeps the export access rules for PDF too", async () => {
    const free = await setupTenant({}, { entitled: false });
    const entitled = await setupTenant({ slug: "tenant-other", registrationNo: "KOP-OTHER", adminEmail: "admin@other.test" });
    const viewer = await createStaffSession(entitled.user.tenantId, "tenant-other", "Viewer", "viewer@other.test");

    expect((await pdfOf(free.accessToken, "jurnal-umum")).status).toBe(403);
    expect((await pdfOf(viewer.accessToken, "jurnal-umum")).status).toBe(403);
  });
});
