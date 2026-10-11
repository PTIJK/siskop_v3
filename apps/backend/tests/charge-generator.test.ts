import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, setupTenant } from "./helpers.js";
import { runDailyChargeGeneration } from "../src/modules/market/charge-generator.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

/** The next date on/after `from` (inclusive) that falls on `weekday` (0 = Sunday), as a UTC-midnight Date. */
function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

const sunday = nextWeekday(new Date(), 0);
const monday = nextWeekday(sunday, 1);
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

async function generateCoa(accessToken: string) {
  await request(app()).post("/api/config/accounts/generate-standard").set("Authorization", `Bearer ${accessToken}`);
}

async function createMarketAs(accessToken: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/market/markets")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Pasar Induk", ...overrides });
  return res;
}

async function createStallAs(accessToken: string, marketId: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/market/stalls")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ marketId, code: "A-01", kind: "KIOS", ...overrides });
  return res;
}

async function createContractAs(accessToken: string, stallId: string, memberId: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/market/contracts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ stallId, memberId, startDate: dateKey(monday), rentAmount: 500000, rentPeriod: "MONTHLY", ...overrides });
  return res;
}

async function setupContractWithLevy(accessToken: string, tenantId: string) {
  const market = await createMarketAs(accessToken);
  const stall = await createStallAs(accessToken, market.body.data.id);
  const member = await createMemberAs(accessToken);
  await request(app())
    .post("/api/market/levy-rates")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ marketId: market.body.data.id, stallKind: "KIOS", name: "Kebersihan", amount: 5000, period: "DAILY" });
  const contract = await createContractAs(accessToken, stall.body.data.id, member.id, { startDate: dateKey(monday) });
  await generateCoa(accessToken);
  return { market, stall, member, contract, tenantId };
}

describe("runDailyChargeGeneration — RETRIBUSI", () => {
  it("creates one charge per active DAILY levy rate for each active contract, on an operating day", async () => {
    const admin = await setupTenant();
    const ctx = await setupContractWithLevy(admin.accessToken, admin.user.tenantId);

    const result = await runDailyChargeGeneration(monday);

    // The fixture's contract also starts today, so its SEWA anniversary charge
    // is created alongside the RETRIBUSI one — 2 total, 1 of each kind.
    expect(result.created).toBe(2);
    const charge = await db.charge.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, kind: "RETRIBUSI" } });
    expect(charge.amount.toString()).toBe("5000");
    expect(charge.stallId).toBe(ctx.stall.body.data.id);

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "CHARGE_ACCRUAL", sourceId: charge.id },
      include: { lines: true }
    });
    const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(5000);
  });

  it("does not generate anything on a closed day (Sunday)", async () => {
    const admin = await setupTenant();
    await setupContractWithLevy(admin.accessToken, admin.user.tenantId);

    const result = await runDailyChargeGeneration(sunday);

    expect(result.skipped).toBe(1);
    const count = await db.charge.count({ where: { tenantId: admin.user.tenantId } });
    expect(count).toBe(0);
  });

  it("is idempotent — running twice for the same operating day does not duplicate", async () => {
    const admin = await setupTenant();
    await setupContractWithLevy(admin.accessToken, admin.user.tenantId);

    await runDailyChargeGeneration(monday);
    const second = await runDailyChargeGeneration(monday);

    expect(second.created).toBe(0);
    const count = await db.charge.count({ where: { tenantId: admin.user.tenantId, kind: "RETRIBUSI" } });
    expect(count).toBe(1);
  });
});

describe("runDailyChargeGeneration — SEWA", () => {
  it("generates a charge on the contract's start date, and not again until the next period", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const member = await createMemberAs(admin.accessToken);
    await createContractAs(admin.accessToken, stall.body.data.id, member.id, { startDate: dateKey(monday), rentAmount: 500000 });
    await generateCoa(admin.accessToken);

    const result = await runDailyChargeGeneration(monday);

    expect(result.created).toBe(1);
    const charge = await db.charge.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, kind: "SEWA" } });
    expect(charge.amount.toString()).toBe("500000");
    expect(dateKey(charge.periodStart)).toBe(dateKey(monday));

    const again = await runDailyChargeGeneration(monday);
    expect(again.created).toBe(0);
    const count = await db.charge.count({ where: { tenantId: admin.user.tenantId, kind: "SEWA" } });
    expect(count).toBe(1);
  });

  it("shifts the due date to the next operating day when the anniversary falls on a closed day, but keeps periodStart as the anniversary itself", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const member = await createMemberAs(admin.accessToken);
    await createContractAs(admin.accessToken, stall.body.data.id, member.id, { startDate: dateKey(sunday), rentAmount: 500000 });
    await generateCoa(admin.accessToken);

    const result = await runDailyChargeGeneration(monday);

    expect(result.created).toBe(1);
    const charge = await db.charge.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, kind: "SEWA" } });
    expect(dateKey(charge.periodStart)).toBe(dateKey(sunday));
    expect(dateKey(charge.dueDate)).toBe(dateKey(monday));
  });
});

