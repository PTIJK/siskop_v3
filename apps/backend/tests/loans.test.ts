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

async function createLoanConfigAs(accessToken: string, overrides: Partial<typeof KUR_MIKRO> = {}) {
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
    const loans = await db.loan.findMany({ where: { memberId: member.id } });
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
      where: { id: created.body.data.id },
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
