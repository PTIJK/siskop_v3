import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, postEquity, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const BEFORE = new Date("2025-12-10T00:00:00Z");
const DURING = new Date("2026-03-10T00:00:00Z");
const AFTER = new Date("2027-02-01T00:00:00Z");
const PERIOD = { from: "2026-01-01", to: "2026-12-31" };

/** Books income (Kas debit / Pendapatan credit) or, negative, an expense (Beban debit / Kas credit). */
async function postIncome(tenantId: string, amount: number, entryDate: Date, unitId: string | null = null) {
  const kas =
    (await db.account.findFirst({ where: { tenantId, code: "T-KAS" } })) ??
    (await db.account.create({
      data: { tenantId, code: "T-KAS", name: "Kas (test)", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true }
    }));
  const isIncome = amount >= 0;
  const code = isIncome ? "T-PENDAPATAN" : "T-BEBAN";
  const other =
    (await db.account.findFirst({ where: { tenantId, code } })) ??
    (await db.account.create({
      data: {
        tenantId,
        code,
        name: isIncome ? "Pendapatan (test)" : "Beban (test)",
        category: isIncome ? "PENDAPATAN" : "BEBAN",
        normalBalance: isIncome ? "KREDIT" : "DEBIT"
      }
    }));
  const abs = Math.abs(amount).toFixed(2);
  await db.journalEntry.create({
    data: {
      tenantId,
      unitId,
      entryDate,
      sourceType: "MANUAL",
      description: isIncome ? "Pendapatan" : "Beban",
      lines: {
        create: isIncome
          ? [
              { tenantId, accountId: kas.id, debit: abs, credit: 0 },
              { tenantId, accountId: other.id, debit: 0, credit: abs }
            ]
          : [
              { tenantId, accountId: other.id, debit: abs, credit: 0 },
              { tenantId, accountId: kas.id, debit: 0, credit: abs }
            ]
      }
    }
  });
}

type Row = { key: string; values: Record<string, string>; total: string };

async function statement(accessToken: string, query: Record<string, string> = PERIOD) {
  const res = await request(app())
    .get("/api/reports/regulatory/perubahan-ekuitas")
    .query(query)
    .set("Authorization", `Bearer ${accessToken}`);
  return res;
}

function row(body: { rows: Row[] }, key: string): Row {
  const found = body.rows.find((r) => r.key === key);
  if (!found) throw new Error(`row ${key} missing`);
  return found;
}

describe("GET /api/reports/regulatory/perubahan-ekuitas (Permenkop UKM 2/2024 lampiran)", () => {
  it("rolls each equity column from saldo awal through additions, reductions and SHU to saldo akhir", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_POKOK", 1_000_000, { entryDate: BEFORE });
    await postEquity(tenantId, "SIMPANAN_WAJIB", 2_000_000, { entryDate: BEFORE });
    await postEquity(tenantId, "SIMPANAN_WAJIB", 500_000, { entryDate: DURING });
    await postEquity(tenantId, "SIMPANAN_WAJIB", -300_000, { entryDate: DURING });
    await postEquity(tenantId, "HIBAH", 750_000, { entryDate: DURING });
    await postEquity(tenantId, "SIMPANAN_POKOK", 9_000_000, { entryDate: AFTER });
    await postIncome(tenantId, 400_000, BEFORE); // closed-year SHU still unclosed in the ledger
    await postIncome(tenantId, 1_000_000, DURING);
    await postIncome(tenantId, -250_000, DURING);

    const res = await statement(admin.accessToken);

    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(body.periode).toEqual(PERIOD);
    expect(row(body, "SALDO_AWAL").values).toMatchObject({ SIMPANAN_POKOK: "1000000", SIMPANAN_WAJIB: "2000000", HIBAH: "0", SHU: "400000" });
    expect(row(body, "PENAMBAHAN").values).toMatchObject({ SIMPANAN_WAJIB: "500000", HIBAH: "750000" });
    expect(row(body, "PENGURANGAN").values).toMatchObject({ SIMPANAN_WAJIB: "300000" });
    expect(row(body, "SHU_PERIODE_BERJALAN").values.SHU).toBe("750000");
    expect(row(body, "SALDO_AKHIR").values).toMatchObject({
      SIMPANAN_POKOK: "1000000",
      SIMPANAN_WAJIB: "2200000",
      HIBAH: "750000",
      SHU: "1150000"
    });
    expect(row(body, "SALDO_AWAL").total).toBe("3400000");
    expect(row(body, "SALDO_AKHIR").total).toBe("5100000");
  });

  it("ends on the same equity total as the Neraca at the period end", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_POKOK", "1000000.10", { entryDate: BEFORE });
    await postEquity(tenantId, "MODAL_PENYERTAAN", "3000000", { entryDate: DURING });
    await postIncome(tenantId, 123_456.78, DURING);

    const [res, neraca] = await Promise.all([
      statement(admin.accessToken),
      request(app())
        .get("/api/reports/regulatory/neraca")
        .query({ asOfDate: PERIOD.to })
        .set("Authorization", `Bearer ${admin.accessToken}`)
    ]);

    expect(row(res.body.data, "SALDO_AKHIR").total).toBe(neraca.body.data.ekuitas.total);
  });

  it("reports Modal Sendiri at both ends, including the opening-balance adjustment and excluding penyertaan", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_POKOK", 1_000_000, { entryDate: BEFORE });
    await postEquity(tenantId, "CADANGAN_UMUM", 200_000, { entryDate: DURING });
    await postEquity(tenantId, "MODAL_PENYERTAAN", 5_000_000, { entryDate: DURING });
    await db.modalSendiriAdjustment.create({
      data: { tenantId, effectiveDate: new Date("2020-01-01T00:00:00Z"), amount: 300_000, reason: "Saldo awal", createdBy: "test" }
    });

    const res = await statement(admin.accessToken);

    expect(res.body.data.modalSendiri).toEqual({ awal: "1300000", akhir: "1500000", penyesuaianSaldoAwal: "300000" });
  });

  it("lists unclassified equity accounts in their own column only when there are some", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_POKOK", 1_000_000, { entryDate: BEFORE });

    const before = await statement(admin.accessToken);
    expect(before.body.data.columns.map((c: { key: string }) => c.key)).not.toContain("BELUM_DIKLASIFIKASI");

    const kas = await db.account.findFirstOrThrow({ where: { tenantId, code: "T-KAS" } });
    const legacy = await db.account.create({
      data: { tenantId, code: "3-8000", name: "Modal Lama", category: "EKUITAS", normalBalance: "KREDIT" }
    });
    await db.journalEntry.create({
      data: {
        tenantId,
        entryDate: DURING,
        sourceType: "MANUAL",
        description: "Modal lama",
        lines: {
          create: [
            { tenantId, accountId: kas.id, debit: 50_000, credit: 0 },
            { tenantId, accountId: legacy.id, debit: 0, credit: 50_000 }
          ]
        }
      }
    });

    const after = await statement(admin.accessToken);
    expect(after.body.data.columns.map((c: { key: string }) => c.key)).toContain("BELUM_DIKLASIFIKASI");
    expect(row(after.body.data, "PENAMBAHAN").values.BELUM_DIKLASIFIKASI).toBe("50000");
  });

  it("cuts to one unit, and units plus the unallocated bucket add back up to the consolidated figure", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    const ksp = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
    const toko = await db.cooperativeUnit.create({ data: { tenantId, type: "KONSUMEN", name: "Toko" } });
    await postEquity(tenantId, "MODAL_TETAP", 4_000_000, { entryDate: DURING, unitId: ksp.id });
    await postEquity(tenantId, "MODAL_TETAP", 1_000_000, { entryDate: DURING, unitId: toko.id });
    await postEquity(tenantId, "SIMPANAN_POKOK", 500_000, { entryDate: DURING });
    await postIncome(tenantId, 200_000, DURING, ksp.id);

    const [all, kspOnly, tokoOnly] = await Promise.all([
      statement(admin.accessToken),
      statement(admin.accessToken, { ...PERIOD, unitId: ksp.id }),
      statement(admin.accessToken, { ...PERIOD, unitId: toko.id })
    ]);

    expect(row(kspOnly.body.data, "SALDO_AKHIR").total).toBe("4200000");
    expect(row(tokoOnly.body.data, "SALDO_AKHIR").total).toBe("1000000");
    expect(row(all.body.data, "SALDO_AKHIR").total).toBe("5700000");
  });

  it("never shows another tenant's ledger", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    await postEquity(tenantB.user.tenantId, "SIMPANAN_POKOK", 9_000_000, { entryDate: DURING });

    const res = await statement(tenantA.accessToken);

    expect(row(res.body.data, "SALDO_AKHIR").total).toBe("0");
  });

  it("rejects a period whose start is after its end", async () => {
    const admin = await setupTenant();

    const res = await statement(admin.accessToken, { from: "2026-12-31", to: "2026-01-01" });

    expect(res.status).toBe(422);
  });

  it("is blocked for a tenant without the accounting entitlement", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const res = await statement(admin.accessToken);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("streams a PDF", async () => {
    const admin = await setupTenant();
    await postEquity(admin.user.tenantId, "SIMPANAN_POKOK", 1_000_000, { entryDate: DURING });

    const res = await request(app())
      .get("/api/reports/regulatory/perubahan-ekuitas/pdf")
      .query(PERIOD)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  }, 20_000);
});

describe("Neraca equity grouping", () => {
  it("tags each equity line with its class, orders them as the lampiran does, and subtotals Modal Sendiri", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "MODAL_PENYERTAAN", 5_000_000, { entryDate: DURING });
    await postEquity(tenantId, "HIBAH", 100_000, { entryDate: DURING });
    await postEquity(tenantId, "SIMPANAN_WAJIB", 2_000_000, { entryDate: DURING });
    await postEquity(tenantId, "SIMPANAN_POKOK", 1_000_000, { entryDate: DURING });

    const res = await request(app())
      .get("/api/reports/regulatory/neraca")
      .query({ asOfDate: PERIOD.to })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    const items = res.body.data.ekuitas.items as Array<{ equityClass: string | null; isComputed: boolean }>;
    expect(items.map((i) => i.equityClass)).toEqual(["SIMPANAN_POKOK", "SIMPANAN_WAJIB", "HIBAH", "MODAL_PENYERTAAN", "SHU"]);
    expect(items.at(-1)?.isComputed).toBe(true);
    expect(res.body.data.modalSendiri).toBe("3100000");
    expect(res.body.data.balanced).toBe(true);
  });
});

describe("CALK permodalan", () => {
  it("summarises Modal Sendiri at the period end and whether it reaches the audit threshold", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_POKOK", "4000000000", { entryDate: DURING });
    await postEquity(tenantId, "CADANGAN_UMUM", "1000000000", { entryDate: DURING });
    await postEquity(tenantId, "MODAL_PENYERTAAN", "2000000000", { entryDate: DURING });

    const res = await request(app())
      .get("/api/reports/regulatory/calk")
      .query(PERIOD)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.permodalan).toMatchObject({
      modalSendiri: "5000000000",
      penyesuaianSaldoAwal: "0",
      ambangAudit: "5000000000",
      wajibAudit: true
    });
    expect(res.body.data.permodalan.komposisi).toEqual([
      { equityClass: "SIMPANAN_POKOK", amount: "4000000000" },
      { equityClass: "CADANGAN_UMUM", amount: "1000000000" }
    ]);
  });
});
