import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, createMemberWithPokokSaving, postEquity, setupTenant } from "./helpers.js";

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
  // The cap is 10% of Modal Sendiri as booked in the ledger (Pasal 44), not a
  // hand-typed modal disetor figure.
  async function setModalSendiri(tenantId: string, amount: number | string) {
    await postEquity(tenantId, "SIMPANAN_POKOK", amount, { entryDate: new Date("2020-01-01T00:00:00Z") });
  }

  it("rejects a pengurus member's loan exceeding 10% of Modal Sendiri", async () => {
    const admin = await setupTenant();
    await setModalSendiri(admin.user.tenantId, 10_000_000); // 10% = 1,000,000
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
    await setModalSendiri(admin.user.tenantId, 10_000_000); // 10% = 1,000,000
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
    await setModalSendiri(admin.user.tenantId, "10000000.30"); // 10% = 1,000,000.03
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
    await setModalSendiri(admin.user.tenantId, 10_000_000); // 10% = 1,000,000
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

  it("counts an opening-balance adjustment toward the cap", async () => {
    const admin = await setupTenant();
    await setModalSendiri(admin.user.tenantId, 4_000_000);
    await db.modalSendiriAdjustment.create({
      data: {
        tenantId: admin.user.tenantId,
        effectiveDate: new Date("2020-01-01T00:00:00Z"),
        amount: 6_000_000,
        reason: "Saldo awal sebelum SISKOP",
        createdBy: "test"
      }
    }); // Modal Sendiri 10,000,000 -> cap 1,000,000
    const member = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 12 });

    expect(res.status).toBe(201);
  });

  it("does not count modal penyertaan toward the cap", async () => {
    const admin = await setupTenant();
    await setModalSendiri(admin.user.tenantId, 1_000_000); // cap 100,000
    await postEquity(admin.user.tenantId, "MODAL_PENYERTAAN", 50_000_000);
    const member = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 100_001, termMonths: 12 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RELATED_PARTY_LIMIT_EXCEEDED");
  });

  it("ignores the legacy manual modal disetor field", async () => {
    const admin = await setupTenant();
    await request(app())
      .put("/api/config/modal-disetor")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ modalDisetor: 10_000_000 });
    const member = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 12 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RELATED_PARTY_LIMIT_EXCEEDED");
  });

  it("allows a non-pengurus/pengawas member to borrow the same amount that would exceed the cap for a pengurus member", async () => {
    const admin = await setupTenant();
    await setModalSendiri(admin.user.tenantId, 10_000_000); // 10% = 1,000,000
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_001, termMonths: 12 });

    expect(res.status).toBe(201);
  });
});

describe("POST /api/loans — BMPP pihak tidak terkait (Permenkop UKM 8/2023 Pasal 45)", () => {
  // A 15% concentration warning, not a block: the API asks for confirmation
  // the same way it does for a second loan, and `acknowledgeBmpp` proceeds.
  async function setup(modalSendiri: number) {
    const admin = await setupTenant();
    if (modalSendiri > 0) {
      await postEquity(admin.user.tenantId, "SIMPANAN_WAJIB", modalSendiri, { entryDate: new Date("2020-01-01T00:00:00Z") });
    }
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    return { admin, member, config };
  }

  function borrow(accessToken: string, body: Record<string, unknown>) {
    return request(app()).post("/api/loans").set("Authorization", `Bearer ${accessToken}`).send({ termMonths: 12, ...body });
  }

  it("asks for confirmation above 15% of Modal Sendiri, without creating the loan", async () => {
    const { admin, member, config } = await setup(10_000_000); // 15% = 1,500,000

    const res = await borrow(admin.accessToken, { memberId: member.id, loanConfigId: config.id, principalAmount: 1_500_001 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      bmppExceeded: true,
      bmpp: {
        basis: "KONSOLIDASI",
        modalSendiri: "10000000",
        limitPct: 15,
        limit: "1500000",
        existingPrincipal: "0",
        requested: "1500001"
      }
    });
    expect(await db.loan.count({ where: { tenantId: admin.user.tenantId } })).toBe(0);
  });

  it("creates the loan once the warning is acknowledged", async () => {
    const { admin, member, config } = await setup(10_000_000);

    const res = await borrow(admin.accessToken, {
      memberId: member.id,
      loanConfigId: config.id,
      principalAmount: 1_500_001,
      acknowledgeBmpp: true
    });

    expect(res.status).toBe(201);
  });

  it("does not warn exactly at the 15% limit", async () => {
    const { admin, member, config } = await setup(10_000_000);

    const res = await borrow(admin.accessToken, { memberId: member.id, loanConfigId: config.id, principalAmount: 1_500_000 });

    expect(res.status).toBe(201);
  });

  it("counts the member's existing active loans toward the limit", async () => {
    const { admin, member, config } = await setup(10_000_000);
    await borrow(admin.accessToken, { memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000 });

    const res = await borrow(admin.accessToken, {
      memberId: member.id,
      loanConfigId: config.id,
      principalAmount: 600_000,
      force: true
    });

    expect(res.status).toBe(200);
    expect(res.body.data.bmpp.existingPrincipal).toBe("1000000");
  });

  it("stays silent when there is no Modal Sendiri to judge against (tenant without a ledger)", async () => {
    const { admin, member, config } = await setup(0);

    const res = await borrow(admin.accessToken, { memberId: member.id, loanConfigId: config.id, principalAmount: 50_000_000 });

    expect(res.status).toBe(201);
  });

  it("keeps the related-party 10% cap a hard block, acknowledgement or not", async () => {
    const admin = await setupTenant();
    await postEquity(admin.user.tenantId, "SIMPANAN_WAJIB", 10_000_000, { entryDate: new Date("2020-01-01T00:00:00Z") });
    const pengurus = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });
    const config = await createLoanConfigAs(admin.accessToken);

    const res = await borrow(admin.accessToken, {
      memberId: pengurus.id,
      loanConfigId: config.id,
      principalAmount: 1_000_001,
      acknowledgeBmpp: true
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RELATED_PARTY_LIMIT_EXCEEDED");
  });
});

describe("BMPP basis for a multi-unit (KSU) koperasi — the lending unit's own Modal Sendiri", () => {
  async function ksu() {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    const ksp = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId, type: "KSP" } });
    await db.cooperativeUnit.create({ data: { tenantId, type: "KONSUMEN", name: "Toko" } });
    const early = new Date("2020-01-01T00:00:00Z");
    await postEquity(tenantId, "SIMPANAN_POKOK", 10_000_000, { entryDate: early }); // unallocated
    await postEquity(tenantId, "MODAL_TETAP", 2_000_000, { entryDate: early, unitId: ksp.id });
    const config = await createLoanConfigAs(admin.accessToken);
    return { admin, ksp, config };
  }

  it("caps a pengurus loan at 10% of the unit's Modal Sendiri, not the koperasi's", async () => {
    const { admin, ksp, config } = await ksu();
    const pengurus = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });

    const res = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: pengurus.id, loanConfigId: config.id, principalAmount: 200_001, termMonths: 12, unitId: ksp.id });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RELATED_PARTY_LIMIT_EXCEEDED");
  });

  it("reports the unit basis in the headroom endpoint", async () => {
    const { admin, ksp } = await ksu();
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const res = await request(app())
      .get("/api/loans/bmpp-headroom")
      .query({ memberId: member.id, unitId: ksp.id })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      basis: "UNIT",
      unitId: ksp.id,
      modalSendiri: "2000000",
      isRelatedParty: false,
      limitPct: 15,
      limit: "300000",
      existingPrincipal: "0",
      headroom: "300000"
    });
  });
});

describe("GET /api/loans/bmpp-headroom", () => {
  it("returns a pengurus member's remaining room under the 10% cap, net of active loans", async () => {
    const admin = await setupTenant();
    await postEquity(admin.user.tenantId, "SIMPANAN_WAJIB", 10_000_000, { entryDate: new Date("2020-01-01T00:00:00Z") });
    const pengurus = await createMemberWithPokokSaving(admin.accessToken, { isPengurus: true });
    const config = await createLoanConfigAs(admin.accessToken);
    await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: pengurus.id, loanConfigId: config.id, principalAmount: 400_000, termMonths: 12 });

    const res = await request(app())
      .get("/api/loans/bmpp-headroom")
      .query({ memberId: pengurus.id })
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      basis: "KONSOLIDASI",
      unitId: null,
      isRelatedParty: true,
      limitPct: 10,
      limit: "1000000",
      existingPrincipal: "400000",
      headroom: "600000"
    });
  });

  it("never reveals another tenant's member", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const memberB = await createMemberWithPokokSaving(tenantB.accessToken);

    const res = await request(app())
      .get("/api/loans/bmpp-headroom")
      .query({ memberId: memberB.id })
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
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

describe("Loans audit trail", () => {
  it("audits loan disbursement", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);

    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 3_000_000, termMonths: 12 });

    const log = await db.auditLog.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, action: "loan.create", entityId: created.body.data.id }
    });
    expect(log.actorUserId).toBe(admin.user.id);
    expect(log.after).toMatchObject({ memberId: member.id, principalAmount: "3000000" });
  });

  it("audits a loan payment with before/after remaining balance", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });
    const totalAmount = created.body.data.totalAmount as string;

    await request(app())
      .post(`/api/loans/${created.body.data.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 100_000, paidAt: "2026-01-25", dueDate: "2026-01-25" });

    const log = await db.auditLog.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, action: "loan.payment", entityId: created.body.data.id }
    });
    expect(log.before).toMatchObject({ remainingAmount: totalAmount, status: "ACTIVE" });
    expect(log.after).toMatchObject({ amount: "100000" });
  });

  it("writes no audit row when a payment is rejected for a non-active loan", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const config = await createLoanConfigAs(admin.accessToken);
    const created = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, loanConfigId: config.id, principalAmount: 1_000_000, termMonths: 6 });
    // Pay it off fully so its status flips to COMPLETED.
    await request(app())
      .post(`/api/loans/${created.body.data.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: created.body.data.totalAmount, paidAt: "2026-01-25", dueDate: "2026-01-25" });

    const res = await request(app())
      .post(`/api/loans/${created.body.data.id}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 10_000, paidAt: "2026-02-25", dueDate: "2026-02-25" });
    expect(res.status).toBe(422);

    const count = await db.auditLog.count({ where: { tenantId: admin.user.tenantId, action: "loan.payment" } });
    expect(count).toBe(1); // only the successful first payment
  });
});
