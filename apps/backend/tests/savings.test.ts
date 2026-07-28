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

const POKOK_CONFIG = {
  name: "Simpanan Pokok",
  type: "POKOK" as const,
  rateType: "BUNGA" as const,
  rate: 0,
  periodUnit: "MONTHLY" as const
};

async function createConfigAs(accessToken: string, overrides: Partial<typeof POKOK_CONFIG> = {}) {
  const res = await request(app())
    .post("/api/savings/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ ...POKOK_CONFIG, ...overrides });
  return res.body.data as { id: string; type: string };
}

describe("GET /api/savings/configs", () => {
  it("returns the tenant's saving configs", async () => {
    const admin = await setupTenant();
    await createConfigAs(admin.accessToken);

    const res = await request(app())
      .get("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Simpanan Pokok");
  });
});

describe("POST /api/savings/configs", () => {
  it("creates a config", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(POKOK_CONFIG);

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("POKOK");
  });

  it("rejects a teller — config.update is not granted to that role", async () => {
    const admin = await setupTenant();
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send(POKOK_CONFIG);

    expect(res.status).toBe(403);
  });
});

describe("POST /api/savings", () => {
  it("creates a saving account with an initial deposit", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken);

    const res = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id, initialDeposit: 500_000 });

    expect(res.status).toBe(201);
    expect(res.body.data.balance).toBe("500000");
  });

  it("lets a teller create a saving account", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken);
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id });

    expect(res.status).toBe(201);
  });

  // Every tenant has exactly one auto-provisioned unit in Phase 1 — no
  // unit-picker UI, but the financial row must still carry a non-null unitId.
  it("resolves unitId to the tenant's sole unit without any client input", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken);
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    const res = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id });

    const saving = await db.saving.findUnique({ where: { id: res.body.data.id } });
    expect(saving?.unitId).toBe(unit.id);
  });
});

describe("POST /api/savings/:id/deposit", () => {
  it("increments the balance", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken);
    const saving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id, initialDeposit: 100_000 });

    const res = await request(app())
      .post(`/api/savings/${saving.body.data.id}/deposit`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 50_000 });

    expect(res.status).toBe(201);

    const updated = await db.saving.findUnique({ where: { id: saving.body.data.id } });
    expect(updated?.balance.toString()).toBe("150000");
  });

  it("lets a teller deposit", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken);
    const saving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id });
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .post(`/api/savings/${saving.body.data.id}/deposit`)
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send({ amount: 10_000 });

    expect(res.status).toBe(201);
  });

  it("rejects a zero amount with 422", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken);
    const saving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id });

    const res = await request(app())
      .post(`/api/savings/${saving.body.data.id}/deposit`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 0 });

    expect(res.status).toBe(422);
  });
});

describe("POST /api/savings/:id/withdraw", () => {
  it("decrements the balance", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken, { type: "SUKARELA", name: "Simpanan Sukarela" });
    const saving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id, initialDeposit: 100_000 });

    const res = await request(app())
      .post(`/api/savings/${saving.body.data.id}/withdraw`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 30_000 });

    expect(res.status).toBe(201);
    const updated = await db.saving.findUnique({ where: { id: saving.body.data.id } });
    expect(updated?.balance.toString()).toBe("70000");
  });

  it("rejects a withdrawal exceeding the balance", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken, { type: "SUKARELA", name: "Simpanan Sukarela" });
    const saving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id, initialDeposit: 10_000 });

    const res = await request(app())
      .post(`/api/savings/${saving.body.data.id}/withdraw`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 50_000 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE");
  });

  // The core POKOK-protection business rule: mandatory principal savings
  // cannot be withdrawn while the member has any active loan.
  it("rejects a POKOK withdrawal while the member has an active loan", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const pokokConfig = await createConfigAs(admin.accessToken);
    const saving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: pokokConfig.id, initialDeposit: 500_000 });

    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });
    const loanConfig = await db.loanConfig.create({
      data: {
        tenantId: admin.user.tenantId,
        name: "KUR Mikro",
        type: "KONVENSIONAL",
        rateType: "BUNGA",
        rate: 12,
        maxTermMonths: 36,
        isActive: true
      }
    });
    await db.loan.create({
      data: {
        tenantId: admin.user.tenantId,
        unitId: unit.id,
        memberId: member.id,
        loanConfigId: loanConfig.id,
        principalAmount: 1_000_000,
        totalAmount: 1_120_000,
        termMonths: 12,
        monthlyPayment: 93_333,
        remainingAmount: 1_120_000,
        status: "ACTIVE"
      }
    });

    const res = await request(app())
      .post(`/api/savings/${saving.body.data.id}/withdraw`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 100_000 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CANNOT_WITHDRAW_POKOK");
  });
});

describe("GET /api/savings/:id/transactions", () => {
  it("returns a paginated transaction history", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken, { type: "SUKARELA", name: "Simpanan Sukarela" });
    const saving = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id, initialDeposit: 100_000 });
    await request(app())
      .post(`/api/savings/${saving.body.data.id}/deposit`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 10_000 });

    const res = await request(app())
      .get(`/api/savings/${saving.body.data.id}/transactions`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(2);
  });
});

describe("GET /api/savings", () => {
  it("returns a paginated list for the tenant", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken);
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id });

    const res = await request(app())
      .get("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
