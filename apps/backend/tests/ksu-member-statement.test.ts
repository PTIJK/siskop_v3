import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, setupTenant } from "./helpers.js";
import { checkUnitSegregation, getMemberUnitStatement, SEGREGATION_THRESHOLD_RP } from "../src/modules/ksu/service.js";
import { getShuDistribution } from "../src/modules/reports/regulatory-service.js";

/**
 * Day 4 KSU spike, Part A: a per-member SHU statement broken out by
 * CooperativeUnit, reusing getShuDistribution's real formula/config
 * (modules/reports/regulatory-service.ts) rather than a placeholder one —
 * see modules/ksu/service.ts#getMemberUnitStatement's own doc comment for
 * exactly how the tenant-wide pool is sliced per unit.
 *
 * A wide [2020-01-01, 2100-01-01] period is used throughout (same convention
 * as tests/reports.test.ts) so every transaction created "now" by these
 * tests falls inside it regardless of wall-clock date.
 */

const WIDE_FROM = new Date("2020-01-01");
const WIDE_TO = new Date("2100-01-01");
const todayStr = new Date().toISOString().split("T")[0];

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function createSecondUnit(accessToken: string, type = "KSP", name = "Simpan Pinjam Unit B") {
  const res = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type, name });
  return res.body.data as { id: string; name: string };
}

async function setShuConfig(
  accessToken: string,
  data: { jasaSimpananPercent: number; jasaPinjamanPercent: number; cadanganPercent: number; lainnyaPercent: number }
) {
  return request(app())
    .put("/api/config/shu-distribution")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(data);
}

async function postIncome(tenantId: string, amount: number) {
  const kas = await db.account.create({
    data: { tenantId, code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" }
  });
  const pendapatan = await db.account.create({
    data: { tenantId, code: "4-1000", name: "Pendapatan Bunga", category: "PENDAPATAN", normalBalance: "KREDIT" }
  });
  await db.journalEntry.create({
    data: {
      tenantId,
      entryDate: new Date(),
      sourceType: "MANUAL",
      description: "test income",
      status: "POSTED",
      lines: {
        create: [
          { tenantId, accountId: kas.id, debit: amount },
          { tenantId, accountId: pendapatan.id, credit: amount }
        ]
      }
    }
  });
}

/**
 * A flat-margin loan config (type KONVENSIONAL + rateType MARGIN triggers
 * lib/loan-calc.ts's flat-margin branch even without loanType SYARIAH) with
 * rate=100 over a 12-month term makes totalInterest == principalAmount, so
 * splitPrincipalAndInterest's interestRatio is exactly 0.5 — a clean,
 * hand-verifiable 50/50 principal/interest split on every payment. No
 * AccountMapping is set up for this config: getShuDistribution's jasaPinjaman
 * re-derives interest straight from LoanPayment rows (see its own comment),
 * never from JournalLine, so an unmapped (UNPOSTED_MISSING_MAPPING) loan
 * still contributes correctly.
 */
async function createFlatMarginLoanConfig(accessToken: string) {
  const res = await request(app())
    .post("/api/loans/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Flat 100%/12bln", type: "KONVENSIONAL", rateType: "MARGIN", rate: 100, maxTermMonths: 12 });
  return res.body.data as { id: string };
}

async function disburseLoan(
  accessToken: string,
  data: { memberId: string; loanConfigId: string; principalAmount: number; unitId?: string; force?: boolean }
) {
  return request(app())
    .post("/api/loans")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ termMonths: 12, ...data });
}

async function payLoan(accessToken: string, loanId: string, amount: number) {
  return request(app())
    .post(`/api/loans/${loanId}/pay`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ amount, penalty: 0, paidAt: todayStr, dueDate: todayStr });
}

describe("getMemberUnitStatement", () => {
  it("splits a member's real SHU across the two units they're active in, matching getShuDistribution's own totals", async () => {
    const admin = await setupTenant();
    const unitA = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const unitB = await createSecondUnit(admin.accessToken);

    // 40% jasaSimpanan / 40% jasaPinjaman / 10% cadangan / 10% lainnya.
    const configRes = await setShuConfig(admin.accessToken, {
      jasaSimpananPercent: 40,
      jasaPinjamanPercent: 40,
      cadanganPercent: 10,
      lainnyaPercent: 10
    });
    expect(configRes.status).toBe(200);

    // shuBerjalan = 1,000,000 for the period -> jasaSimpananTotal = jasaPinjamanTotal = 400,000.
    await postIncome(admin.user.tenantId, 1_000_000);

    // Sole member: createMemberWithPokokSaving deposits 500,000 into a POKOK
    // saving, which (per lib/units.ts#getDefaultUnitId, savings has no
    // unit-picker) always lands in the tenant's default unit — unitA here.
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const loanConfig = await createFlatMarginLoanConfig(admin.accessToken);

    // Loan 1: unitA (default, no unitId override), principal 10,000,000 ->
    // totalAmount 20,000,000 -> interestRatio 0.5.
    const loanA = await disburseLoan(admin.accessToken, {
      memberId: member.id,
      loanConfigId: loanConfig.id,
      principalAmount: 10_000_000
    });
    expect(loanA.status).toBe(201);

    // Loan 2: unitB, principal 5,000,000, same config -> interestRatio 0.5.
    // The member already has an active loan (loanA), so this needs force:true
    // (see modules/loans/service.ts#createLoan's existing-loan guard).
    const loanB = await disburseLoan(admin.accessToken, {
      memberId: member.id,
      loanConfigId: loanConfig.id,
      principalAmount: 5_000_000,
      unitId: unitB.id,
      force: true
    });
    expect(loanB.status).toBe(201);

    // Payment on loanA of 2,000,000 -> interest 1,000,000 (0.5 ratio).
    const payA = await payLoan(admin.accessToken, loanA.body.data.id, 2_000_000);
    expect(payA.status).toBe(200);
    // Payment on loanB of 1,000,000 -> interest 500,000 (0.5 ratio).
    const payB = await payLoan(admin.accessToken, loanB.body.data.id, 1_000_000);
    expect(payB.status).toBe(200);

    // ── Hand-computed expected values ──────────────────────────────────────
    // avgSavingsBalance (member, tenant-wide, sole member with savings):
    //   balance at WIDE_FROM (before the deposit) = 0, at WIDE_TO = 500,000
    //   -> avg = 250,000 = totalAvgSavings (sole contributor).
    //   All of it is unitA's (Saving.unitId is always the default unit) ->
    //   unitA gets 100% of jasaSimpanan, unitB gets 0%.
    //   jasaSimpanan(unitA) = 250,000/250,000 * 400,000 = 400,000.00
    //   jasaSimpanan(unitB) = 0.
    //
    // interestPaid (member, tenant-wide, sole member with loan payments):
    //   unitA: 1,000,000 ; unitB: 500,000 ; total = 1,500,000.
    //   jasaPinjaman(unitA) = 1,000,000/1,500,000 * 400,000 = 266,666.67
    //   jasaPinjaman(unitB) =   500,000/1,500,000 * 400,000 = 133,333.33
    //
    // shu(unitA) = 400,000.00 + 266,666.67 = 666,666.67
    // shu(unitB) =      0.00  + 133,333.33 = 133,333.33
    // sum        = 800,000.00 == member's tenant-wide totalShu (jasaSimpanan
    //              400,000 + jasaPinjaman 400,000, ratio 1 since sole member).

    const statement = await getMemberUnitStatement(admin.user.tenantId, member.id, { from: WIDE_FROM, to: WIDE_TO });

    expect(statement.memberId).toBe(member.id);
    expect(statement.units).toHaveLength(2);

    const unitAResult = statement.units.find((u) => u.unitId === unitA.id);
    const unitBResult = statement.units.find((u) => u.unitId === unitB.id);
    expect(unitAResult?.unitName).toBe(unitA.name);
    expect(unitBResult?.unitName).toBe(unitB.name);
    expect(unitAResult?.shu).toBeCloseTo(666_666.67, 2);
    expect(unitBResult?.shu).toBeCloseTo(133_333.33, 2);

    // Cross-check against getShuDistribution's own tenant-wide totalShu for
    // this member — the two per-unit figures must add back up to it.
    const distribution = await getShuDistribution(admin.user.tenantId, WIDE_FROM, WIDE_TO);
    const memberRow = distribution.anggota.find((a) => a.memberId === member.id);
    expect(memberRow).toBeTruthy();
    expect(Number(memberRow?.totalShu)).toBeCloseTo(800_000, 2);
    expect((unitAResult?.shu ?? 0) + (unitBResult?.shu ?? 0)).toBeCloseTo(Number(memberRow?.totalShu), 2);
  });

  it("reports shu: 0 for every unit the member is active in when no ShuDistributionConfig is set", async () => {
    const admin = await setupTenant();
    const unitA = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const statement = await getMemberUnitStatement(admin.user.tenantId, member.id, { from: WIDE_FROM, to: WIDE_TO });

    expect(statement.units).toHaveLength(1);
    expect(statement.units[0].unitId).toBe(unitA.id);
    expect(statement.units[0].shu).toBe(0);
  });

  it("throws NOT_FOUND for a member id that doesn't belong to the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const memberB = await createMemberWithPokokSaving(tenantB.accessToken);

    await expect(getMemberUnitStatement(tenantA.user.tenantId, memberB.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
  });
});

// ── Day 4 KSU spike, Part B: unit loan-volume segregation threshold ─────────

describe("checkUnitSegregation", () => {
  it("returns OK when a KSP unit's active loan principal is well under the threshold", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const loanConfig = await createFlatMarginLoanConfig(admin.accessToken);
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const loan = await disburseLoan(admin.accessToken, {
      memberId: member.id,
      loanConfigId: loanConfig.id,
      principalAmount: 100_000_000
    });
    expect(loan.status).toBe(201);

    const result = await checkUnitSegregation(admin.user.tenantId, unit.id);
    expect(result.unitId).toBe(unit.id);
    expect(result.currentVolumeRp).toBe(100_000_000);
    expect(result.thresholdRp).toBe(SEGREGATION_THRESHOLD_RP);
    expect(result.status).toBe("OK");
  });

  it("returns APPROACHING_THRESHOLD at Rp 4.8B (>= 90% of the Rp 5B threshold)", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const loanConfig = await createFlatMarginLoanConfig(admin.accessToken);
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const loan = await disburseLoan(admin.accessToken, {
      memberId: member.id,
      loanConfigId: loanConfig.id,
      principalAmount: 4_800_000_000
    });
    expect(loan.status).toBe(201);

    const result = await checkUnitSegregation(admin.user.tenantId, unit.id);
    expect(result.currentVolumeRp).toBe(4_800_000_000);
    expect(result.status).toBe("APPROACHING_THRESHOLD");
  });

  it("returns EXCEEDED once a KSP unit's active loan principal reaches the Rp 5B threshold", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const loanConfig = await createFlatMarginLoanConfig(admin.accessToken);
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const loan = await disburseLoan(admin.accessToken, {
      memberId: member.id,
      loanConfigId: loanConfig.id,
      principalAmount: 5_200_000_000
    });
    expect(loan.status).toBe(201);

    const result = await checkUnitSegregation(admin.user.tenantId, unit.id);
    expect(result.currentVolumeRp).toBe(5_200_000_000);
    expect(result.status).toBe("EXCEEDED");
  });

  it("excludes a COMPLETED loan's principal from the current volume", async () => {
    const admin = await setupTenant();
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const loanConfig = await createFlatMarginLoanConfig(admin.accessToken);
    const member = await createMemberWithPokokSaving(admin.accessToken);

    // rate=0 branch of calculateLoan (annualRate 0) -> totalAmount == principal,
    // so a single full-amount payment completes the loan in one shot.
    const zeroRateConfig = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Zero Rate", type: "KONVENSIONAL", rateType: "BUNGA", rate: 0, maxTermMonths: 12 });

    const loan = await disburseLoan(admin.accessToken, {
      memberId: member.id,
      loanConfigId: zeroRateConfig.body.data.id,
      principalAmount: 4_900_000_000
    });
    expect(loan.status).toBe(201);

    const pay = await payLoan(admin.accessToken, loan.body.data.id, 4_900_000_000);
    expect(pay.status).toBe(200);
    expect(pay.body.data.status).toBe("COMPLETED");

    const result = await checkUnitSegregation(admin.user.tenantId, unit.id);
    expect(result.currentVolumeRp).toBe(0);
    expect(result.status).toBe("OK");
  });

  it("returns NOT_APPLICABLE for a non-KSP unit regardless of its loan volume", async () => {
    const admin = await setupTenant();
    const konsumenUnit = await createSecondUnit(admin.accessToken, "KONSUMEN", "Unit Toko");

    const result = await checkUnitSegregation(admin.user.tenantId, konsumenUnit.id);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.currentVolumeRp).toBe(0);
    expect(result.thresholdRp).toBe(SEGREGATION_THRESHOLD_RP);
  });

  it("throws NOT_FOUND for a unit id that doesn't belong to the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: tenantB.user.tenantId } });

    await expect(checkUnitSegregation(tenantA.user.tenantId, unitB.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
  });
});
