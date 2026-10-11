import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { comparisonAsOf, comparisonRange } from "../src/lib/comparison.js";
import { app, setupTenant } from "./helpers.js";

describe("comparisonRange", () => {
  it("PREVIOUS_YEAR shifts both ends back one year", () => {
    expect(comparisonRange("PREVIOUS_YEAR", "2026-03-10", "2026-04-20")).toEqual({ from: "2025-03-10", to: "2025-04-20" });
  });

  it("PREVIOUS_YEAR clamps 29 February and keeps month ends month ends", () => {
    expect(comparisonRange("PREVIOUS_YEAR", "2024-02-29", "2024-02-29")).toEqual({ from: "2023-02-28", to: "2023-02-28" });
    expect(comparisonRange("PREVIOUS_YEAR", "2024-02-01", "2024-02-29")).toEqual({ from: "2023-02-01", to: "2023-02-28" });
  });

  it("PREVIOUS_PERIOD of a whole calendar month is the whole month before, whatever its length", () => {
    expect(comparisonRange("PREVIOUS_PERIOD", "2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(comparisonRange("PREVIOUS_PERIOD", "2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparisonRange("PREVIOUS_PERIOD", "2026-01-01", "2026-01-31")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("PREVIOUS_PERIOD of whole months or a whole year shifts by the same number of months", () => {
    expect(comparisonRange("PREVIOUS_PERIOD", "2026-01-01", "2026-12-31")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(comparisonRange("PREVIOUS_PERIOD", "2026-07-01", "2026-09-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  it("PREVIOUS_PERIOD of any other range is the same number of days immediately before it", () => {
    expect(comparisonRange("PREVIOUS_PERIOD", "2026-10-11", "2026-10-20")).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    expect(comparisonRange("PREVIOUS_PERIOD", "2026-10-10", "2026-10-10")).toEqual({ from: "2026-10-09", to: "2026-10-09" });
  });
});

describe("comparisonAsOf", () => {
  it("PREVIOUS_PERIOD is one month earlier, and a month end maps to the previous month end", () => {
    expect(comparisonAsOf("PREVIOUS_PERIOD", "2026-10-15")).toBe("2026-09-15");
    expect(comparisonAsOf("PREVIOUS_PERIOD", "2026-10-31")).toBe("2026-09-30");
    expect(comparisonAsOf("PREVIOUS_PERIOD", "2026-03-31")).toBe("2026-02-28");
    expect(comparisonAsOf("PREVIOUS_PERIOD", "2026-01-31")).toBe("2025-12-31");
  });

  it("PREVIOUS_YEAR is the same date a year earlier", () => {
    expect(comparisonAsOf("PREVIOUS_YEAR", "2026-10-10")).toBe("2025-10-10");
    expect(comparisonAsOf("PREVIOUS_YEAR", "2024-02-29")).toBe("2023-02-28");
    expect(comparisonAsOf("PREVIOUS_YEAR", "2024-12-31")).toBe("2023-12-31");
  });
});

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const Y = new Date().getFullYear() - 1;

async function seed(token: string, tenantId: string) {
  const all = await db.account.findMany({ where: { tenantId } });
  const id = (code: string) => all.find((a) => a.code === code)!.id;
  const post = (entryDate: string, lines: Array<{ accountId: string; debit?: number; credit?: number }>) =>
    request(app()).post("/api/journal").set(bearer(token)).send({ entryDate, description: `J ${entryDate}`, entryType: "UMUM", lines });
  // last year: modal 1,000,000 (Jan) + income 300,000 (Jun) ; this year: income 500,000 (Mar)
  await post(`${Y}-01-05`, [{ accountId: id("1-1000"), debit: 1_000_000 }, { accountId: id("3-1000"), credit: 1_000_000 }]);
  await post(`${Y}-06-10`, [{ accountId: id("1-1000"), debit: 300_000 }, { accountId: id("4-1000"), credit: 300_000 }]);
  await post(`${Y + 1}-03-10`, [{ accountId: id("1-1000"), debit: 500_000 }, { accountId: id("4-1000"), credit: 500_000 }]);
}

describe("compare on the statements", () => {
  it("Neraca returns the same report for the earlier date next to the current one", async () => {
    const admin = await setupTenant();
    await seed(admin.accessToken, admin.user.tenantId);

    const res = await request(app())
      .get("/api/reports/regulatory/neraca")
      .query({ asOfDate: `${Y + 1}-06-30`, compare: "PREVIOUS_YEAR" })
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.aset.total).toBe("1800000");
    expect(res.body.data.comparison.asOfDate).toBe(`${Y}-06-30`);
    expect(res.body.data.comparison.aset.total).toBe("1300000");
    expect(res.body.data.comparison.balanced).toBe(true);
    expect(res.body.data.comparison.comparison).toBeUndefined(); // one level only
  });

  it("Hasil Usaha compares a period with the one before it", async () => {
    const admin = await setupTenant();
    await seed(admin.accessToken, admin.user.tenantId);

    const res = await request(app())
      .get("/api/reports/regulatory/laporan-hasil-usaha")
      .query({ from: `${Y + 1}-01-01`, to: `${Y + 1}-12-31`, compare: "PREVIOUS_PERIOD" })
      .set(bearer(admin.accessToken));

    expect(res.body.data.pendapatan.total).toBe("500000");
    expect(res.body.data.comparison.periode).toEqual({ from: `${Y}-01-01`, to: `${Y}-12-31` });
    expect(res.body.data.comparison.pendapatan.total).toBe("300000");
  });

  it("Neraca Saldo compares a period with the one before it", async () => {
    const admin = await setupTenant();
    await seed(admin.accessToken, admin.user.tenantId);

    const res = await request(app())
      .get("/api/reports/accounting/neraca-saldo")
      .query({ from: `${Y + 1}-01-01`, to: `${Y + 1}-12-31`, compare: "PREVIOUS_YEAR" })
      .set(bearer(admin.accessToken));

    const kas = (r: { body: { data: { rows: Array<{ code: string; mutasiDebit: string }> } } }) => r.body.data.rows.find((x) => x.code === "1-1000")!;
    expect(kas(res).mutasiDebit).toBe("500000");
    const prev = (res.body.data.comparison.rows as Array<{ code: string; mutasiDebit: string }>).find((x) => x.code === "1-1000")!;
    expect(prev.mutasiDebit).toBe("1300000");
  });

  it("is optional, and a bad value is rejected", async () => {
    const admin = await setupTenant();

    const none = await request(app()).get("/api/reports/regulatory/neraca").set(bearer(admin.accessToken));
    const bad = await request(app()).get("/api/reports/regulatory/neraca").query({ compare: "LAST_WEEK" }).set(bearer(admin.accessToken));

    expect(none.body.data.comparison).toBeUndefined();
    expect(bad.status).toBe(422);
  });
});
