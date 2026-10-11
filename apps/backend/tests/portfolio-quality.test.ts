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

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const OTHER = { slug: "tenant-other", registrationNo: "KOP-OTHER", adminEmail: "admin@other.test" };

type Admin = Awaited<ReturnType<typeof setupTenant>>;

async function product(tenantId: string, name: string) {
  return db.loanConfig.create({ data: { tenantId, name, type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 } });
}

interface LoanSeed {
  member: string;
  config: string;
  unitId: string;
  daysOverdue: number;
  /** principal still owed, via a schedule of one installment. */
  outstanding: number;
  status?: "ACTIVE" | "COMPLETED" | "PENDING" | "DEFAULTED";
  /** No installment schedule: outstanding comes from remainingAmount x principal / total. */
  legacy?: { principal: number; total: number; remaining: number };
}

async function loan(admin: Admin, s: LoanSeed) {
  const tenantId = admin.user.tenantId;
  const kol = s.daysOverdue <= 30 ? "LANCAR" : s.daysOverdue <= 90 ? "DALAM_PERHATIAN" : s.daysOverdue <= 120 ? "KURANG_LANCAR" : s.daysOverdue <= 180 ? "DIRAGUKAN" : "MACET";
  const principal = s.legacy?.principal ?? s.outstanding * 2; // half already repaid when there is a schedule
  const created = await db.loan.create({
    data: {
      tenantId,
      unitId: s.unitId,
      memberId: s.member,
      loanConfigId: s.config,
      principalAmount: principal,
      totalAmount: s.legacy?.total ?? principal,
      termMonths: 12,
      monthlyPayment: 100,
      remainingAmount: s.legacy?.remaining ?? s.outstanding,
      status: s.status ?? "ACTIVE",
      kolCategory: kol,
      daysOverdue: s.daysOverdue
    }
  });
  if (!s.legacy) {
    await db.loanInstallment.create({
      data: {
        tenantId,
        loanId: created.id,
        seq: 1,
        dueDate: new Date("2026-01-01"),
        principalDue: principal,
        interestDue: 0,
        principalPaid: principal - s.outstanding,
        status: s.outstanding === principal ? "UNPAID" : "PARTIAL"
      }
    });
  }
  return created;
}

async function book(admin: Admin) {
  const tenantId = admin.user.tenantId;
  const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
  const member = await createMemberAs(admin.accessToken);
  const kur = await product(tenantId, "KUR Mikro");
  const musiman = await product(tenantId, "Pinjaman Musiman");
  return { unit, member: member.id as string, kur: kur.id, musiman: musiman.id };
}

const par = (token: string, query: Record<string, string | number> = {}) =>
  request(app()).get("/api/reports/portfolio/par").query(query).set(bearer(token));

describe("GET /api/reports/portfolio/par", () => {
  it("sorts active loans into days-past-due buckets by outstanding principal", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    const base = { member: b.member, config: b.kur, unitId: b.unit.id };
    await loan(admin, { ...base, daysOverdue: 0, outstanding: 600 });
    await loan(admin, { ...base, daysOverdue: 30, outstanding: 100 });
    await loan(admin, { ...base, daysOverdue: 31, outstanding: 80 });
    await loan(admin, { ...base, daysOverdue: 60, outstanding: 70 });
    await loan(admin, { ...base, daysOverdue: 61, outstanding: 60 });
    await loan(admin, { ...base, daysOverdue: 90, outstanding: 40 });
    await loan(admin, { ...base, daysOverdue: 91, outstanding: 30 });
    await loan(admin, { ...base, daysOverdue: 400, outstanding: 20 });

    const res = await par(admin.accessToken);

    expect(res.status).toBe(200);
    const d = res.body.data;
    const bucket = (name: string) => d.buckets.find((x: { bucket: string }) => x.bucket === name);
    expect(d.buckets.map((x: { bucket: string }) => x.bucket)).toEqual(["CURRENT", "D1_30", "D31_60", "D61_90", "D90_PLUS"]);
    expect(bucket("CURRENT")).toMatchObject({ loans: 1, outstanding: "600" });
    expect(bucket("D1_30")).toMatchObject({ loans: 1, outstanding: "100" });
    expect(bucket("D31_60")).toMatchObject({ loans: 2, outstanding: "150" });
    expect(bucket("D61_90")).toMatchObject({ loans: 2, outstanding: "100" });
    expect(bucket("D90_PLUS")).toMatchObject({ loans: 2, outstanding: "50" });
    expect(d).toMatchObject({ loans: 8, totalOutstanding: "1000" });
    // share of the book
    expect(bucket("CURRENT").share).toBe("60");
    // PAR1 = everything past due 400/1000, PAR30 = more than 30 days 300/1000, PAR90 = more than 90 days 50/1000
    expect(d.ratios).toEqual({ par1: "40", par30: "30", par90: "5" });
    expect(d.nplRatio).toBe("5");
  });

  it("counts only active loans: completed, pending and defaulted ones are not in the book", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    const base = { member: b.member, config: b.kur, unitId: b.unit.id, daysOverdue: 0 };
    await loan(admin, { ...base, outstanding: 100 });
    for (const status of ["COMPLETED", "PENDING", "DEFAULTED"] as const) await loan(admin, { ...base, outstanding: 999, status });

    const res = await par(admin.accessToken);

    expect(res.body.data).toMatchObject({ loans: 1, totalOutstanding: "100" });
  });

  it("derives principal for a loan without a schedule from what is still owed", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    // principal 1000 of a 1200 total, 600 of the total still owed -> 500 of principal
    await loan(admin, { member: b.member, config: b.kur, unitId: b.unit.id, daysOverdue: 0, outstanding: 0, legacy: { principal: 1000, total: 1200, remaining: 600 } });

    const res = await par(admin.accessToken);

    expect(res.body.data.totalOutstanding).toBe("500");
  });

  it("breaks the book down by product with its own PAR figures", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    await loan(admin, { member: b.member, config: b.kur, unitId: b.unit.id, daysOverdue: 0, outstanding: 700 });
    await loan(admin, { member: b.member, config: b.kur, unitId: b.unit.id, daysOverdue: 40, outstanding: 100 });
    await loan(admin, { member: b.member, config: b.musiman, unitId: b.unit.id, daysOverdue: 95, outstanding: 200 });

    const res = await par(admin.accessToken);

    const byName = Object.fromEntries(res.body.data.byProduct.map((p: { name: string }) => [p.name, p]));
    expect(byName["KUR Mikro"]).toMatchObject({ loans: 2, outstanding: "800", overdue30: "100", overdue90: "0", par30: "12.5", par90: "0" });
    expect(byName["Pinjaman Musiman"]).toMatchObject({ loans: 1, outstanding: "200", overdue30: "200", overdue90: "200", par30: "100", par90: "100" });
    // biggest product first
    expect(res.body.data.byProduct[0].name).toBe("KUR Mikro");
  });

  it("is zero everywhere for an empty book instead of dividing by zero", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const res = await par(admin.accessToken);

    expect(res.body.data).toMatchObject({ loans: 0, totalOutstanding: "0", ratios: { par1: "0", par30: "0", par90: "0" }, nplRatio: "0", byProduct: [] });
    expect(res.body.data.buckets.every((x: { loans: number }) => x.loans === 0)).toBe(true);
  });

  it("cuts to one unit, checks the unit like every report, and never sees another tenant's loans", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const other = await setupTenant(OTHER, { entitled: false });
    const b = await book(admin);
    const ob = await book(other);
    const unitB = await db.cooperativeUnit.create({ data: { tenantId: admin.user.tenantId, name: "Unit B", type: "KSP" } });
    await loan(admin, { member: b.member, config: b.kur, unitId: b.unit.id, daysOverdue: 0, outstanding: 100 });
    await loan(admin, { member: b.member, config: b.kur, unitId: unitB.id, daysOverdue: 0, outstanding: 40 });
    await loan(other, { member: ob.member, config: ob.kur, unitId: ob.unit.id, daysOverdue: 0, outstanding: 9999 });

    const all = await par(admin.accessToken);
    const one = await par(admin.accessToken, { unitId: unitB.id });
    const cross = await par(admin.accessToken, { unitId: ob.unit.id });

    expect(all.body.data.totalOutstanding).toBe("140");
    expect(one.body.data.totalOutstanding).toBe("40");
    expect(cross.status).toBe(404);
  });

  it("needs reports:read but not the accounting package", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");

    expect((await par(admin.accessToken)).status).toBe(200);
    expect((await par(kasir.accessToken)).status).toBe(403);
  });
});

describe("GET /api/reports/portfolio/par/loans", () => {
  it("lists the loans in one bucket, largest first, so a figure can be traced to its loans", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    const base = { member: b.member, config: b.kur, unitId: b.unit.id };
    const small = await loan(admin, { ...base, daysOverdue: 100, outstanding: 50 });
    const big = await loan(admin, { ...base, daysOverdue: 200, outstanding: 500 });
    await loan(admin, { ...base, daysOverdue: 10, outstanding: 70 });

    const res = await request(app()).get("/api/reports/portfolio/par/loans").query({ bucket: "D90_PLUS" }).set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { loanId: string }) => r.loanId)).toEqual([big.id, small.id]);
    expect(res.body.data[0]).toMatchObject({ daysOverdue: 200, outstanding: "500", loanConfigName: "KUR Mikro", kolCategory: "MACET" });
    expect(res.body.data[0].memberName).toBeTruthy();
    expect(res.body.meta.total).toBe(2);
  });

  it("paginates and rejects an unknown bucket", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    for (let i = 0; i < 3; i++) await loan(admin, { member: b.member, config: b.kur, unitId: b.unit.id, daysOverdue: 0, outstanding: 10 + i });

    const page = await request(app()).get("/api/reports/portfolio/par/loans").query({ bucket: "CURRENT", limit: 2, page: 2 }).set(bearer(admin.accessToken));
    const bad = await request(app()).get("/api/reports/portfolio/par/loans").query({ bucket: "D999" }).set(bearer(admin.accessToken));

    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(bad.status).toBe(422);
  });
});

describe("GET /api/reports/portfolio/collection-efficiency", () => {
  async function installment(admin: Admin, loanId: string, seq: number, dueDate: string, due: number, paid: number) {
    await db.loanInstallment.create({
      data: {
        tenantId: admin.user.tenantId,
        loanId,
        seq,
        dueDate: new Date(dueDate),
        principalDue: due * 0.8,
        interestDue: due * 0.2,
        principalPaid: paid * 0.8,
        interestPaid: paid * 0.2,
        status: paid >= due ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID"
      }
    });
  }

  it("compares what was paid with what fell due in the period", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    const l1 = await db.loan.create({
      data: { tenantId: admin.user.tenantId, unitId: b.unit.id, memberId: b.member, loanConfigId: b.kur, principalAmount: 1000, totalAmount: 1000, termMonths: 3, monthlyPayment: 100, remainingAmount: 500 }
    });
    // due in October: 1000 paid in full, 1000 half paid, 1000 unpaid; due in November (outside): ignored
    await installment(admin, l1.id, 1, "2026-10-05", 1000, 1000);
    await installment(admin, l1.id, 2, "2026-10-15", 1000, 500);
    await installment(admin, l1.id, 3, "2026-10-31", 1000, 0);
    await installment(admin, l1.id, 4, "2026-11-01", 1000, 0);
    await db.loanPayment.create({
      data: { tenantId: admin.user.tenantId, loanId: l1.id, amount: 1700, paidAt: new Date("2026-10-20T03:00:00Z"), createdBy: admin.user.id }
    });
    await db.loanPayment.create({
      data: { tenantId: admin.user.tenantId, loanId: l1.id, amount: 999, paidAt: new Date("2026-09-30T03:00:00Z"), createdBy: admin.user.id }
    });

    const res = await request(app())
      .get("/api/reports/portfolio/collection-efficiency")
      .query({ from: "2026-10-01", to: "2026-10-31" })
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      periode: { from: "2026-10-01", to: "2026-10-31" },
      installmentsDue: 3,
      amountDue: "3000",
      paidOnDue: "1500",
      efficiency: "50",
      cashCollected: "1700"
    });
  });

  it("reports no efficiency when nothing fell due, and flags loans that have no schedule", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    await loan(admin, { member: b.member, config: b.kur, unitId: b.unit.id, daysOverdue: 0, outstanding: 0, legacy: { principal: 100, total: 100, remaining: 50 } });

    const res = await request(app())
      .get("/api/reports/portfolio/collection-efficiency")
      .query({ from: "2026-10-01", to: "2026-10-31" })
      .set(bearer(admin.accessToken));

    expect(res.body.data).toMatchObject({ installmentsDue: 0, amountDue: "0", efficiency: null, loansWithoutSchedule: 1 });
  });

  it("ignores pending loans, cuts to a unit, and rejects a reversed period", async () => {
    const admin = await setupTenant({}, { entitled: false });
    const b = await book(admin);
    const unitB = await db.cooperativeUnit.create({ data: { tenantId: admin.user.tenantId, name: "Unit B", type: "KSP" } });
    const mk = (unitId: string, status: "ACTIVE" | "PENDING") =>
      db.loan.create({ data: { tenantId: admin.user.tenantId, unitId, memberId: b.member, loanConfigId: b.kur, principalAmount: 100, totalAmount: 100, termMonths: 1, monthlyPayment: 100, remainingAmount: 100, status } });
    const a1 = await mk(b.unit.id, "ACTIVE");
    const a2 = await mk(unitB.id, "ACTIVE");
    const p = await mk(b.unit.id, "PENDING");
    for (const [l, i] of [[a1, 1], [a2, 1], [p, 1]] as const) await installment(admin, l.id, i, "2026-10-10", 100, 0);
    const q = { from: "2026-10-01", to: "2026-10-31" };

    const all = await request(app()).get("/api/reports/portfolio/collection-efficiency").query(q).set(bearer(admin.accessToken));
    const one = await request(app()).get("/api/reports/portfolio/collection-efficiency").query({ ...q, unitId: unitB.id }).set(bearer(admin.accessToken));
    const bad = await request(app()).get("/api/reports/portfolio/collection-efficiency").query({ from: "2026-10-31", to: "2026-10-01" }).set(bearer(admin.accessToken));

    expect(all.body.data.amountDue).toBe("200"); // the pending loan is not collectable yet
    expect(one.body.data.amountDue).toBe("100");
    expect(bad.status).toBe(422);
  });
});
