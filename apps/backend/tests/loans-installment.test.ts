import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const PASAR_HARIAN = {
  name: "Pinjaman Pasar Harian",
  type: "KONVENSIONAL" as const,
  rateType: "HARIAN" as const,
  rate: 0.5, // %/year is irrelevant here; HARIAN uses a real-day/360 rate.
  maxTermMonths: 12,
  installmentFrequency: "DAILY" as const,
  maxInstallments: 200
};

async function createLoanConfigAs(accessToken: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/loans/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ ...PASAR_HARIAN, ...overrides });
  return res.body.data as { id: string };
}

describe("POST /api/loans/configs — frequency/method compatibility", () => {
  it("rejects ANNUITY (default BUNGA+KONVENSIONAL) with a non-MONTHLY frequency", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        name: "KUR Harian",
        type: "KONVENSIONAL",
        rateType: "BUNGA",
        rate: 12,
        maxTermMonths: 12,
        installmentFrequency: "DAILY",
        maxInstallments: 100
      });

    expect(res.status).toBe(422);
  });

  it("allows HARIAN with a DAILY frequency", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(PASAR_HARIAN);
    expect(res.status).toBe(201);
    expect(res.body.data.installmentFrequency).toBe("DAILY");
  });
});

describe("POST /api/loans — DAILY installment schedule", () => {
  it("creates an installment for each operating day, none on Sunday/holiday", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 1_000_000,
        installmentCount: 30,
        disbursedAt: "2026-10-01" // a Thursday
      });

    expect(res.status).toBe(201);
    const loanId = res.body.data.id as string;

    const schedule = await db.loanInstallment.findMany({
      where: { loanId, tenantId: admin.user.tenantId },
      orderBy: { seq: "asc" }
    });
    expect(schedule).toHaveLength(30);
    for (const inst of schedule) {
      expect(inst.dueDate.getUTCDay()).not.toBe(0);
    }
    // Each installment is rounded up to a Rp500 multiple (D8) except possibly the last.
    for (const inst of schedule.slice(0, -1)) {
      const amount = inst.principalDue.plus(inst.interestDue);
      expect(amount.mod(500).toNumber()).toBe(0);
    }
  });

  it("sums principalDue/interestDue across installments to the loan's principal/total interest", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: "1000000",
        installmentCount: 30,
        disbursedAt: "2026-10-01"
      });
    expect(res.status).toBe(201);

    const loan = await db.loan.findFirstOrThrow({ where: { id: res.body.data.id, tenantId: admin.user.tenantId } });
    const schedule = await db.loanInstallment.findMany({ where: { loanId: loan.id, tenantId: admin.user.tenantId } });

    const { Prisma } = await import("@prisma/client");
    const sumPrincipal = schedule.reduce((s, i) => s.plus(i.principalDue), new Prisma.Decimal(0));
    const sumInterest = schedule.reduce((s, i) => s.plus(i.interestDue), new Prisma.Decimal(0));
    expect(sumPrincipal.toString()).toBe(loan.principalAmount.toString());
    expect(sumInterest.toString()).toBe(loan.totalAmount.sub(loan.principalAmount).toString());
  });
});

describe("POST /api/loans — rate override (D3)", () => {
  it("rejects a rate override with no rateNote", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 1_000_000,
        installmentCount: 30,
        rate: 5
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RATE_NOTE_REQUIRED");
  });

  it("rejects a rate override above the 24%/year regulatory cap even with a note", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 1_000_000,
        installmentCount: 30,
        rate: 30,
        rateNote: "Disetujui manajer"
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RATE_EXCEEDS_REGULATORY_CAP");
  });

  it("saves an overridden rate with its note and audits the change", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: 1_000_000,
        installmentCount: 30,
        rate: 5,
        rateNote: "Pedagang lama, disetujui manajer"
      });

    expect(res.status).toBe(201);
    expect(res.body.data.rate).toBe("5");
    expect(res.body.data.rateNote).toBe("Pedagang lama, disetujui manajer");

    const log = await db.auditLog.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, action: "loan.create", entityId: res.body.data.id }
    });
    expect(log.after).toMatchObject({ rate: "5", rateNote: "Pedagang lama, disetujui manajer" });
  });
});

describe("POST /api/loans/:id/pay — installment allocation", () => {
  async function createDailyLoan(accessToken: string, memberId: string, configId: string) {
    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        memberId,
        loanConfigId: configId,
        principalAmount: "1000000",
        installmentCount: 10,
        disbursedAt: "2026-10-01"
      });
    return res.body.data as { id: string; tenantId: string };
  }

  it("allocates a payment across installments oldest-first, closing full ones and leaving a partial", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const loan = await createDailyLoan(admin.accessToken, member.id, config.id);

    const schedule = await db.loanInstallment.findMany({
      where: { loanId: loan.id, tenantId: admin.user.tenantId },
      orderBy: { seq: "asc" }
    });
    const [first, second] = schedule;
    const firstAmount = first.principalDue.plus(first.interestDue);
    const secondAmount = second.principalDue.plus(second.interestDue);
    const payAmount = firstAmount.plus(secondAmount.div(2));

    const res = await request(app())
      .post(`/api/loans/${loan.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: payAmount.toString(), paidAt: "2026-10-05" });

    expect(res.status).toBe(200);

    const after = await db.loanInstallment.findMany({
      where: { loanId: loan.id, tenantId: admin.user.tenantId },
      orderBy: { seq: "asc" }
    });
    expect(after[0].status).toBe("PAID");
    expect(after[1].status).toBe("PARTIAL");
    expect(after[2].status).toBe("UNPAID");
  });

  it("rejects a payment larger than the loan's remaining amount", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const loan = await createDailyLoan(admin.accessToken, member.id, config.id);
    const created = await db.loan.findFirstOrThrow({ where: { id: loan.id, tenantId: admin.user.tenantId } });

    const res = await request(app())
      .post(`/api/loans/${loan.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: created.remainingAmount.plus(1).toString(), paidAt: "2026-10-05" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PAYMENT_EXCEEDS_REMAINING");
  });

  it("degrades KOL from the oldest overdue unpaid installment once schedule-based", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        memberId: member.id,
        loanConfigId: config.id,
        principalAmount: "1000000",
        installmentCount: 100,
        disbursedAt: "2025-01-01"
      });
    const loanId = created.body.data.id as string;

    const schedule = await db.loanInstallment.findMany({
      where: { loanId, tenantId: admin.user.tenantId },
      orderBy: { seq: "asc" }
    });
    // Pay off installment #1 exactly, leaving #2 (long overdue by "today") the oldest unpaid.
    const firstAmount = schedule[0].principalDue.plus(schedule[0].interestDue);

    const res = await request(app())
      .post(`/api/loans/${loanId}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: firstAmount.toString(), paidAt: new Date().toISOString().slice(0, 10) });

    expect(res.status).toBe(200);
    expect(res.body.data.kolCategory).not.toBe("LANCAR");
  });
});
