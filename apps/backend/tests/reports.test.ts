import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const KAS = { code: "1-1000", name: "Kas", category: "ASET" as const, normalBalance: "DEBIT" as const, isCashEquivalent: true };
const SIMPANAN_SUKARELA_ACC = {
  code: "2-1000",
  name: "Simpanan Sukarela",
  category: "KEWAJIBAN" as const,
  normalBalance: "KREDIT" as const,
  isCashEquivalent: false
};
const PENDAPATAN_BUNGA = {
  code: "4-1000",
  name: "Pendapatan Bunga",
  category: "PENDAPATAN" as const,
  normalBalance: "KREDIT" as const,
  isCashEquivalent: false
};

async function createAccountAs(accessToken: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/config/accounts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ ...KAS, ...overrides });
  return res.body.data as { id: string; code: string };
}

async function mapDeposit(accessToken: string, sourceId: string, debitAccountId: string, creditAccountId: string) {
  return request(app())
    .post("/api/config/account-mappings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ sourceType: "SAVING_CONFIG", sourceId, transactionKind: "DEPOSIT", debitAccountId, creditAccountId });
}

/** Deposits into a fresh Simpanan Sukarela account, with Kas <-> Simpanan mapped, so a real JournalEntry posts. */
async function setupMappedDeposit(accessToken: string, memberId: string, amount: number) {
  const kas = await createAccountAs(accessToken);
  const simpanan = await createAccountAs(accessToken, SIMPANAN_SUKARELA_ACC);
  const config = await request(app())
    .post("/api/savings/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Simpanan Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 3, periodUnit: "YEARLY" });
  await mapDeposit(accessToken, config.body.data.id, kas.id, simpanan.id);
  await request(app())
    .post("/api/savings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ memberId, savingConfigId: config.body.data.id, initialDeposit: amount });
  return { kas, simpanan, config: config.body.data as { id: string } };
}

// ── RPT-01 / RPT-02 ──────────────────────────────────────────────────────────

describe("GET /api/reports/financial", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app()).get("/api/reports/financial");
    expect(res.status).toBe(401);
  });

  it("aggregates savings/loan totals within the given range", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    await setupMappedDeposit(admin.accessToken, member.id, 500_000);

    const res = await request(app())
      .get("/api/reports/financial")
      .query({ startDate: "2020-01-01", endDate: "2100-01-01" })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.saldoAkhirSimpanan).toBe("500000");
    expect(res.body.data.transaksiSimpanan.deposit.count).toBe(1);
  });

  it("rejects a teller — reports.read is not granted to that role", async () => {
    const admin = await setupTenant();
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app()).get("/api/reports/financial").set("Authorization", `Bearer ${teller.accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/reports/rat", () => {
  it("returns membership growth and KOL distribution for the given year", async () => {
    const admin = await setupTenant();
    await createMemberAs(admin.accessToken);

    const res = await request(app())
      .get("/api/reports/rat")
      .query({ year: new Date().getFullYear() })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.keanggotaan.akhirTahun).toBe(1);
  });
});

// ── Regulatory: Neraca ───────────────────────────────────────────────────────

describe("GET /api/reports/regulatory/neraca", () => {
  it("is balanced (Aset = Kewajiban + Ekuitas) after a mapped deposit posts", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    await setupMappedDeposit(admin.accessToken, member.id, 500_000);

    const res = await request(app())
      .get("/api/reports/regulatory/neraca")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.balanced).toBe(true);
    expect(res.body.data.aset.total).toBe("500000");
    expect(res.body.data.kewajiban.total).toBe("500000");
  });

  it("excludes a same-day cutoff's own transactions when asOfDate is omitted vs. explicit (endOfDay regression)", async () => {
    // Regression for the date-range bug class: an explicit `asOfDate` of today
    // must include everything posted today, same as the default (no param) path.
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    await setupMappedDeposit(admin.accessToken, member.id, 500_000);

    const today = new Date().toISOString().split("T")[0];
    const withParam = await request(app())
      .get("/api/reports/regulatory/neraca")
      .query({ asOfDate: today })
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const withoutParam = await request(app())
      .get("/api/reports/regulatory/neraca")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(withParam.body.data.aset.total).toBe(withoutParam.body.data.aset.total);
    expect(withParam.body.data.aset.total).toBe("500000");
  });
});

// ── Regulatory: Arus Kas ─────────────────────────────────────────────────────

describe("GET /api/reports/regulatory/arus-kas", () => {
  it("returns a catatan when no account is marked as cash-equivalent", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/reports/regulatory/arus-kas")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.catatan).toBeTruthy();
  });

  it("classifies a saving deposit as an operating cash inflow", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    await setupMappedDeposit(admin.accessToken, member.id, 500_000);

    const res = await request(app())
      .get("/api/reports/regulatory/arus-kas")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.aktivitasOperasi.total).toBe("500000");
    expect(res.body.data.balanced).toBe(true);
  });

  it("rejects a period where `from` is after `to`", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/reports/regulatory/arus-kas")
      .query({ from: "2026-02-01", to: "2026-01-01" })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(422);
  });
});

// ── Regulatory: Laporan Hasil Usaha + SHU distribution ──────────────────────

describe("GET /api/reports/regulatory/laporan-hasil-usaha", () => {
  it("computes SHU berjalan as pendapatan minus beban for the period", async () => {
    const admin = await setupTenant();
    const kas = await createAccountAs(admin.accessToken);
    const pendapatan = await createAccountAs(admin.accessToken, PENDAPATAN_BUNGA);

    await db.journalEntry.create({
      data: {
        tenantId: admin.user.tenantId,
        entryDate: new Date(),
        sourceType: "MANUAL",
        description: "test income",
        status: "POSTED",
        lines: { create: [{ tenantId: admin.user.tenantId, accountId: kas.id, debit: 100_000 }, { tenantId: admin.user.tenantId, accountId: pendapatan.id, credit: 100_000 }] }
      }
    });

    const res = await request(app())
      .get("/api/reports/regulatory/laporan-hasil-usaha")
      .query({ from: "2020-01-01", to: "2100-01-01" })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.shuBerjalan).toBe("100000");
  });
});

describe("GET /api/reports/regulatory/shu-distribution", () => {
  it("returns a catatan when ShuDistributionConfig is not set", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/reports/regulatory/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.alokasi).toBeNull();
    expect(res.body.data.catatan).toBeTruthy();
  });

  it("allocates SHU across the configured buckets once set", async () => {
    const admin = await setupTenant();
    await request(app())
      .put("/api/config/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ jasaSimpananPercent: 25, jasaPinjamanPercent: 25, cadanganPercent: 40, lainnyaPercent: 10 });

    const kas = await createAccountAs(admin.accessToken);
    const pendapatan = await createAccountAs(admin.accessToken, PENDAPATAN_BUNGA);
    await db.journalEntry.create({
      data: {
        tenantId: admin.user.tenantId,
        entryDate: new Date(),
        sourceType: "MANUAL",
        description: "test income",
        status: "POSTED",
        lines: { create: [{ tenantId: admin.user.tenantId, accountId: kas.id, debit: 1_000_000 }, { tenantId: admin.user.tenantId, accountId: pendapatan.id, credit: 1_000_000 }] }
      }
    });

    const res = await request(app())
      .get("/api/reports/regulatory/shu-distribution")
      .query({ from: "2020-01-01", to: "2100-01-01" })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.alokasi.cadangan.total).toBe("400000");
  });

  it("splits jasaSimpanan into shuPokokWajib/shuSukarela proportional to the member's own balance mix", async () => {
    const admin = await setupTenant();
    await request(app())
      .put("/api/config/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ jasaSimpananPercent: 50, jasaPinjamanPercent: 0, cadanganPercent: 40, lainnyaPercent: 10 });

    const member = await createMemberAs(admin.accessToken);
    const kas = await createAccountAs(admin.accessToken);

    const pokokAcc = await createAccountAs(admin.accessToken, {
      code: "3-1000",
      name: "Simpanan Pokok",
      category: "EKUITAS",
      normalBalance: "KREDIT",
      isCashEquivalent: false
    });
    const pokokConfig = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Simpanan Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
    await mapDeposit(admin.accessToken, pokokConfig.body.data.id, kas.id, pokokAcc.id);
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: pokokConfig.body.data.id, initialDeposit: 300_000 });

    const sukarelaAcc = await createAccountAs(admin.accessToken, SIMPANAN_SUKARELA_ACC);
    const sukarelaConfig = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Simpanan Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "YEARLY" });
    await mapDeposit(admin.accessToken, sukarelaConfig.body.data.id, kas.id, sukarelaAcc.id);
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: sukarelaConfig.body.data.id, initialDeposit: 100_000 });

    const pendapatan = await createAccountAs(admin.accessToken, PENDAPATAN_BUNGA);
    await db.journalEntry.create({
      data: {
        tenantId: admin.user.tenantId,
        entryDate: new Date(),
        sourceType: "MANUAL",
        description: "test income",
        status: "POSTED",
        lines: {
          create: [
            { tenantId: admin.user.tenantId, accountId: kas.id, debit: 1_000_000 },
            { tenantId: admin.user.tenantId, accountId: pendapatan.id, credit: 1_000_000 }
          ]
        }
      }
    });

    const res = await request(app())
      .get("/api/reports/regulatory/shu-distribution")
      .query({ from: "2020-01-01", to: "2100-01-01" })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    const row = res.body.data.anggota.find((a: { memberId: string }) => a.memberId === member.id);
    expect(row).toBeTruthy();
    expect(row.no).toBe(1);

    const jasaSimpanan = Number(row.jasaSimpanan);
    const shuPokokWajib = Number(row.shuPokokWajib);
    const shuSukarela = Number(row.shuSukarela);

    expect(shuPokokWajib + shuSukarela).toBeCloseTo(jasaSimpanan, 2);
    // Balance mix is 300_000 Pokok : 100_000 Sukarela, i.e. 3:1.
    expect(shuPokokWajib / shuSukarela).toBeCloseTo(3, 1);
  });
});

// ── Regulatory: CALK ─────────────────────────────────────────────────────────

describe("GET/PUT /api/reports/regulatory/calk", () => {
  it("returns empty narrative sections until saved", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/reports/regulatory/calk")
      .query({ from: "2020-01-01", to: "2100-01-01" })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.narasi.UMUM.content).toBe("");
  });

  it("saves a narrative section and reflects it on the next read", async () => {
    const admin = await setupTenant();
    const put = await request(app())
      .put("/api/reports/regulatory/calk/narrative")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ section: "UMUM", content: "Koperasi ini didirikan tahun 2020." });
    expect(put.status).toBe(200);

    const res = await request(app())
      .get("/api/reports/regulatory/calk")
      .query({ from: "2020-01-01", to: "2100-01-01" })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.body.data.narasi.UMUM.content).toBe("Koperasi ini didirikan tahun 2020.");
  });

  it("rejects a viewer trying to save a narrative — reports.update is not granted", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .put("/api/reports/regulatory/calk/narrative")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ section: "UMUM", content: "x" });

    expect(res.status).toBe(403);
  });
});

// ── PDF export smoke tests ───────────────────────────────────────────────────
// Launches a real headless browser — kept to one per report family rather than
// exercising every data branch, since the HTML-building logic itself is already
// covered indirectly through the JSON-returning tests above.

describe("GET /api/reports/*/pdf", () => {
  it("streams a financial report PDF", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/reports/financial/pdf")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.length).toBeGreaterThan(1000);
  }, 20_000);

  it("streams a neraca PDF", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/reports/regulatory/neraca/pdf")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  }, 20_000);
});

describe("regulatory reports accounting entitlement gate", () => {
  it("blocks every /regulatory endpoint for a tenant with no accounting package, but not /financial or /rat", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const neraca = await request(app())
      .get("/api/reports/regulatory/neraca")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(neraca.status).toBe(403);
    expect(neraca.body.error.code).toBe("FEATURE_NOT_ENTITLED");

    const arusKas = await request(app())
      .get("/api/reports/regulatory/arus-kas")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(arusKas.status).toBe(403);

    const shu = await request(app())
      .get("/api/reports/regulatory/shu-distribution")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(shu.status).toBe(403);

    const calk = await request(app())
      .get("/api/reports/regulatory/calk")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(calk.status).toBe(403);

    // Base reports (pre-ledger RPT-01/02) are never gated by a package.
    const financial = await request(app())
      .get("/api/reports/financial")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(financial.status).toBe(200);

    const rat = await request(app())
      .get("/api/reports/rat")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(rat.status).toBe(200);
  });

  it("allows regulatory reports once the tenant's package includes the accounting module", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/reports/regulatory/neraca")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
  });
});
