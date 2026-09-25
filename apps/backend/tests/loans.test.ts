import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createMemberWithPokokSaving, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const KUR_MIKRO = {
  name: "KUR Mikro",
  type: "KONVENSIONAL" as const,
  rateType: "BUNGA" as const,
  rate: 12,
  maxTermMonths: 36
};

async function createLoanConfigAs(
  accessToken: string,
  overrides: Partial<Omit<typeof KUR_MIKRO, "rateType">> & { rateType?: string } = {}
) {
  const res = await request(app())
    .post("/api/loans/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ ...KUR_MIKRO, ...overrides });
  return res.body.data as { id: string; maxTermMonths: number };
}

describe("GET /api/loans/configs", () => {
  it("returns the tenant's loan configs", async () => {
    const admin = await setupTenant();
    await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .get("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("POST /api/loans/configs — regulatory rate cap (Permenkop UKM 8/2023)", () => {
  it("rejects a rate above the 24%/year loan cap", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...KUR_MIKRO, rate: 24.01 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RATE_EXCEEDS_REGULATORY_CAP");
  });

  it("allows a rate exactly at the 24%/year cap", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...KUR_MIKRO, rate: 24 });

    expect(res.status).toBe(201);
  });

  it("allows a rate below the cap", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...KUR_MIKRO, rate: 12 });

    expect(res.status).toBe(201);
  });

  it("rejects an update that raises the rate above the cap", async () => {
    const admin = await setupTenant();
    const config = await createLoanConfigAs(admin.accessToken, { rate: 12 });

    const res = await request(app())
      .put(`/api/loans/configs/${config.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ rate: 25 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RATE_EXCEEDS_REGULATORY_CAP");
  });
});

describe("POST /api/loans", () => {
  it("rejects a loan for a member with no simpanan pokok", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 3_000_000, termMonths: 12 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("MEMBER_HAS_NO_POKOK_SAVING");
  });

  it("creates a loan with calculated monthly payment and total amount", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 3_000_000, termMonths: 12 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.kolCategory).toBe("LANCAR");
    expect(Number(res.body.data.monthlyPayment)).toBeGreaterThan(0);
    expect(Number(res.body.data.totalAmount)).toBeGreaterThan(3_000_000);
  });

  it("computes HARIAN interest from actual calendar days, not termMonths*30", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    // 2026-01-01 -> 2027-01-01 is exactly 365 calendar days (2026 is not a leap year).
    const config = await createLoanConfigAs(admin.accessToken, { rateType: "HARIAN", rate: 12 });

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 3_000_000,
        termMonths: 12,
        disbursedAt: "2026-01-01"
      });

    expect(res.status).toBe(201);
    // dailyRate = 12/360/100; totalInterest = 3_000_000 * dailyRate * 365 = 365_000
    expect(Number(res.body.data.totalAmount)).toBeCloseTo(3_365_000, 2);
    expect(Number(res.body.data.monthlyPayment)).toBeCloseTo(3_365_000 / 12, 2);
  });

  it("resolves unitId to the tenant's sole unit without any client input", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });

    const loan = await db.loan.findUnique({ where: { id: res.body.data.id } });
    expect(loan?.unitId).toBe(unit.id);
  });

  it("returns a 200 warning (not an error) when the member already has an active loan", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 2_000_000, termMonths: 12 });

    expect(res.status).toBe(200);
    expect(res.body.data.hasExistingLoan).toBe(true);
    expect(res.body.data.existingLoan.principalAmount).toBe("1000000");
  });

  it("creates a second loan when force:true is set", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 2_000_000,
        termMonths: 12,
        force: true
      });

    expect(res.status).toBe(201);
    const loans = await db.loan.findMany({ where: { tenantId: admin.user.tenantId, memberId: member.id } });
    expect(loans).toHaveLength(2);
  });

  it("rejects a term exceeding the config's maxTermMonths", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken, { maxTermMonths: 12 });

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 24 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("TERM_EXCEEDS_MAX");
  });
});

describe("POST /api/loans — related-party concentration limit (Permenkop UKM 8/2023)", () => {
  async function setModalDisetor(accessToken: string, amount: number) {
    await request(app())
      .put("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ modalDisetor: amount });
  }

  it("rejects a pengurus member's loan exceeding 10% of modalDisetor", async () => {
    const admin = await setupTenant();
    await setModalDisetor(admin.accessToken, 10_000_000); // 10% = 1,000,000
    const member = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_001, termMonths: 12 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RELATED_PARTY_LIMIT_EXCEEDED");
  });

  it("allows a pengurus member's loan under the 10% threshold", async () => {
    const admin = await setupTenant();
    await setModalDisetor(admin.accessToken, 10_000_000); // 10% = 1,000,000
    const member = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 900_000, termMonths: 12 });

    expect(res.status).toBe(201);
  });

  it("allows a pengurus member's loan exactly at a fractional 10% cap", async () => {
    const admin = await setupTenant();
    await request(app())
      .put("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ modalDisetor: "10000000.30" }); // 10% = 1,000,000.03
    const member = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000.03, termMonths: 12 });

    expect(res.status).toBe(201);
  });

  it("rejects a second loan whose combined principal with an existing active loan exceeds the threshold", async () => {
    const admin = await setupTenant();
    await setModalDisetor(admin.accessToken, 10_000_000); // 10% = 1,000,000
    const member = await createMemberWithPokokSaving(admin.accessToken, { isPengawas: true });
    const config = await createLoanConfigAs(admin.accessToken);

    const first = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 700_000, termMonths: 12 });
    expect(first.status).toBe(201);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 400_000, termMonths: 12, force: true });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RELATED_PARTY_LIMIT_EXCEEDED");
  });

  it("allows a non-pengurus/pengawas member to borrow the same amount that would exceed the cap for a pengurus member", async () => {
    const admin = await setupTenant();
    await setModalDisetor(admin.accessToken, 10_000_000); // 10% = 1,000,000
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_001, termMonths: 12 });

    expect(res.status).toBe(201);
  });
});

describe("GET /api/loans", () => {
  it("returns a paginated list", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });

    const res = await request(app())
      .get("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("filters by status", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });

    const res = await request(app())
      .get("/api/loans?status=COMPLETED")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.body.data).toHaveLength(0);
  });

  it("returns an empty list for a loanConfigId with no loans", async () => {
    const admin = await setupTenant();
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .get(`/api/loans?loanConfigId=${config.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.body.data).toHaveLength(0);
  });
});

describe("GET /api/loans/:id", () => {
  it("returns loan detail with member and payments", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });

    const res = await request(app())
      .get(`/api/loans/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.member.fullName).toBe("Budi Santoso");
    expect(res.body.data.payments).toEqual([]);
  });

  it("returns 404 for a nonexistent id", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/loans/does-not-exist")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/loans/:id/pay", () => {
  it("records a partial payment and decreases remainingAmount", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });
    const totalAmount = Number(created.body.data.totalAmount);

    const res = await request(app())
      .post(`/api/loans/${created.body.data.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 100_000, paidAt: "2026-01-25", dueDate: "2026-01-25" });

    expect(res.status).toBe(200);
    expect(Number(res.body.data.newRemaining)).toBeCloseTo(totalAmount - 100_000, 2);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.kolCategory).toBeDefined();
  });

  it("marks the loan COMPLETED once the remaining amount reaches zero", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });
    const totalAmount = Number(created.body.data.totalAmount);

    const res = await request(app())
      .post(`/api/loans/${created.body.data.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: totalAmount, paidAt: "2026-01-25", dueDate: "2026-01-25" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("COMPLETED");
    expect(Number(res.body.data.newRemaining)).toBe(0);
  });

  it("rejects a payment on an already-completed loan", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });
    const totalAmount = Number(created.body.data.totalAmount);
    await request(app())
      .post(`/api/loans/${created.body.data.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: totalAmount, paidAt: "2026-01-25", dueDate: "2026-01-25" });

    const res = await request(app())
      .post(`/api/loans/${created.body.data.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 10_000, paidAt: "2026-02-25", dueDate: "2026-02-25" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("LOAN_NOT_ACTIVE");
  });
});

describe("GET /api/loans/overdue", () => {
  it("returns ACTIVE loans with a non-LANCAR KOL category, sorted by severity", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 1_000_000,
        termMonths: 6,
        disbursedAt: "2025-01-25"
      });

    // No payments recorded since disbursement 1+ year ago — every installment
    // is overdue, so KOL classification should have degraded past LANCAR.
    await db.loan.update({
      where: { id: created.body.data.id, tenantId: admin.user.tenantId },
      data: { kolCategory: "MACET", daysOverdue: 200 }
    });

    const res = await request(app())
      .get("/api/loans/overdue")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].kolCategory).toBe("MACET");
    expect(res.body.data[0].lastPaymentAt).toBeNull();
  });
});
