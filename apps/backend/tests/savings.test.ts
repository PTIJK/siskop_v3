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

  it("creates a config with a DAILY period unit", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...POKOK_CONFIG, type: "SUKARELA", periodUnit: "DAILY" });

    expect(res.status).toBe(201);
    expect(res.body.data.periodUnit).toBe("DAILY");
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

describe("POST /api/savings/configs — regulatory rate cap (Permenkop UKM 8/2023)", () => {
  it("rejects a rate above the 9%/year saving cap", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...POKOK_CONFIG, type: "SUKARELA", rate: 9.5 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RATE_EXCEEDS_REGULATORY_CAP");
  });

  it("allows a rate exactly at the 9%/year cap", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...POKOK_CONFIG, type: "SUKARELA", rate: 9 });

    expect(res.status).toBe(201);
  });

  it("allows a rate below the cap", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...POKOK_CONFIG, type: "SUKARELA", rate: 3 });

    expect(res.status).toBe(201);
  });

  it("rejects an update that raises the rate above the cap", async () => {
    const admin = await setupTenant();
    const config = await createConfigAs(admin.accessToken, { type: "SUKARELA", rate: 3 });

    const res = await request(app())
      .put(`/api/savings/configs/${config.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ rate: 9.1 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RATE_EXCEEDS_REGULATORY_CAP");
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

  it("filters by saving config type when ?type= is provided", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const pokokConfig = await createConfigAs(admin.accessToken);
    const sukarelaConfig = await createConfigAs(admin.accessToken, {
      type: "SUKARELA",
      name: "Simpanan Sukarela"
    });
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: pokokConfig.id });
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: sukarelaConfig.id });

    const res = await request(app())
      .get("/api/savings?type=SUKARELA")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].savingConfigId).toBe(sukarelaConfig.id);
  });
});

describe("GET /api/savings/by-member", () => {
  async function openSaving(accessToken: string, memberId: string, savingConfigId: string, initialDeposit?: number) {
    const res = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ memberId, savingConfigId, ...(initialDeposit !== undefined ? { initialDeposit } : {}) });
    return res.body.data as { id: string };
  }

  async function setupThreeTypes(accessToken: string) {
    const pokok = await createConfigAs(accessToken);
    const wajib = await createConfigAs(accessToken, { type: "WAJIB", name: "Simpanan Wajib" });
    const sukarela = await createConfigAs(accessToken, { type: "SUKARELA", name: "Simpanan Sukarela" });
    return { pokok, wajib, sukarela };
  }

  it("returns one row per member with nested savings and an exact Decimal total", async () => {
    const admin = await setupTenant();
    const configs = await setupThreeTypes(admin.accessToken);
    const member = await createMemberAs(admin.accessToken);
    await openSaving(admin.accessToken, member.id, configs.pokok.id, 100_000.1);
    await openSaving(admin.accessToken, member.id, configs.wajib.id, 50_000.2);
    await openSaving(admin.accessToken, member.id, configs.sukarela.id, 0.3);

    const res = await request(app())
      .get("/api/savings/by-member")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0];
    expect(row.memberId).toBe(member.id);
    expect(row.fullName).toBe("Budi Santoso");
    expect(row.savings).toHaveLength(3);
    expect(row.savings.map((s: { type: string }) => s.type)).toEqual(["POKOK", "WAJIB", "SUKARELA"]);
    expect(row.totalBalance).toBe("150000.60");
  });

  it("counts members, not savings, in meta.total", async () => {
    const admin = await setupTenant();
    const configs = await setupThreeTypes(admin.accessToken);
    const a = await createMemberAs(admin.accessToken);
    const b = await createMemberAs(admin.accessToken, { fullName: "Siti Aminah", nik: "3171234567890002" });
    await openSaving(admin.accessToken, a.id, configs.pokok.id);
    await openSaving(admin.accessToken, a.id, configs.wajib.id);
    await openSaving(admin.accessToken, b.id, configs.pokok.id);

    const res = await request(app())
      .get("/api/savings/by-member?limit=1")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(2);
  });

  it("filters members and nested savings by ?type=, recomputing the total", async () => {
    const admin = await setupTenant();
    const configs = await setupThreeTypes(admin.accessToken);
    const a = await createMemberAs(admin.accessToken);
    const b = await createMemberAs(admin.accessToken, { fullName: "Siti Aminah", nik: "3171234567890002" });
    await openSaving(admin.accessToken, a.id, configs.pokok.id, 100_000);
    await openSaving(admin.accessToken, a.id, configs.wajib.id, 25_000);
    await openSaving(admin.accessToken, b.id, configs.pokok.id, 100_000);

    const res = await request(app())
      .get("/api/savings/by-member?type=WAJIB")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].memberId).toBe(a.id);
    expect(res.body.data[0].savings).toHaveLength(1);
    expect(res.body.data[0].totalBalance).toBe("25000.00");
  });

  it("searches by member name", async () => {
    const admin = await setupTenant();
    const configs = await setupThreeTypes(admin.accessToken);
    const a = await createMemberAs(admin.accessToken);
    const b = await createMemberAs(admin.accessToken, { fullName: "Siti Aminah", nik: "3171234567890002" });
    await openSaving(admin.accessToken, a.id, configs.pokok.id);
    await openSaving(admin.accessToken, b.id, configs.pokok.id);

    const res = await request(app())
      .get("/api/savings/by-member?search=siti")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].memberId).toBe(b.id);
  });

  it("excludes inactive savings and members with only inactive savings", async () => {
    const admin = await setupTenant();
    const configs = await setupThreeTypes(admin.accessToken);
    const a = await createMemberAs(admin.accessToken);
    const b = await createMemberAs(admin.accessToken, { fullName: "Siti Aminah", nik: "3171234567890002" });
    await openSaving(admin.accessToken, a.id, configs.pokok.id);
    const closed = await openSaving(admin.accessToken, a.id, configs.wajib.id);
    const bOnly = await openSaving(admin.accessToken, b.id, configs.pokok.id);
    await db.saving.updateMany({
      where: { tenantId: admin.user.tenantId, id: { in: [closed.id, bOnly.id] } },
      data: { isActive: false }
    });

    const res = await request(app())
      .get("/api/savings/by-member")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].memberId).toBe(a.id);
    expect(res.body.data[0].savings).toHaveLength(1);
  });

  it("never returns another tenant's members", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const configB = await createConfigAs(tenantB.accessToken);
    const memberB = await createMemberAs(tenantB.accessToken);
    await openSaving(tenantB.accessToken, memberB.id, configB.id);

    const res = await request(app())
      .get("/api/savings/by-member")
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });
});

describe("GET /api/savings/:id/statement", () => {
  // Builds a SUKARELA account with a fixed, backdated ledger so period math is
  // deterministic: 10 Jan +100.000 (setoran awal), 20 Jan +50.000,
  // 5 Feb −30.000, 6 Feb +1.250,50 bunga, 3 Mar +20.000. Balance 141.250,50.
  async function seedLedger() {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken, { type: "SUKARELA", name: "Simpanan Sukarela" });
    const created = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id, initialDeposit: 100_000 });
    const savingId = created.body.data.id as string;
    const post = (path: string, amount: number, note?: string) =>
      request(app())
        .post(`/api/savings/${savingId}/${path}`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ amount, note });
    await post("deposit", 50_000, "Setoran Januari");
    await post("withdraw", 30_000);
    await post("deposit", 20_000);

    const tenantId = admin.user.tenantId;
    const txns = await db.savingTransaction.findMany({ where: { savingId, tenantId }, orderBy: { createdAt: "asc" } });
    const dates = [new Date(2026, 0, 10, 9), new Date(2026, 0, 20, 9), new Date(2026, 1, 5, 9), new Date(2026, 2, 3, 9)];
    for (const [i, t] of txns.entries()) {
      await db.savingTransaction.update({ where: { id: t.id, tenantId }, data: { createdAt: dates[i] } });
    }
    await db.savingTransaction.create({
      data: {
        savingId,
        tenantId: admin.user.tenantId,
        type: "INTEREST",
        amount: "1250.50",
        createdAt: new Date(2026, 1, 6, 0, 5)
      }
    });
    await db.saving.update({ where: { id: savingId, tenantId }, data: { balance: { increment: "1250.50" } } });
    return { admin, savingId };
  }

  it("returns opening/closing balances and running balance for the period", async () => {
    const { admin, savingId } = await seedLedger();

    const res = await request(app())
      .get(`/api/savings/${savingId}/statement?from=2026-02-01&to=2026-02-28`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.period).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(s.saving.configName).toBe("Simpanan Sukarela");
    expect(s.openingBalance).toBe("150000");
    expect(s.totalDebit).toBe("30000");
    expect(s.totalCredit).toBe("1250.5");
    expect(s.closingBalance).toBe("121250.5");
    expect(s.rows.map((r: { type: string; debit: string; credit: string; balance: string }) => [r.type, r.debit, r.credit, r.balance])).toEqual([
      ["WITHDRAWAL", "30000", "0", "120000"],
      ["INTEREST", "0", "1250.5", "121250.5"]
    ]);
    expect(s.rows[0].createdByName).toBeTruthy();
    expect(s.rows[1].createdByName).toBeNull();
  });

  it("orders rows oldest first and ends at the current balance when nothing was posted after the period", async () => {
    const { admin, savingId } = await seedLedger();

    const res = await request(app())
      .get(`/api/savings/${savingId}/statement?from=2026-01-01&to=2026-12-31`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.openingBalance).toBe("0");
    expect(res.body.data.closingBalance).toBe("141250.5");
    expect(res.body.data.rows).toHaveLength(5);
    expect(res.body.data.rows[0].note).toBe("Setoran awal");
    expect(res.body.data.rows[1].note).toBe("Setoran Januari");
  });

  it("returns opening == closing with no rows for an empty period", async () => {
    const { admin, savingId } = await seedLedger();

    const res = await request(app())
      .get(`/api/savings/${savingId}/statement?from=2026-01-21&to=2026-02-04`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(0);
    expect(res.body.data.openingBalance).toBe("150000");
    expect(res.body.data.closingBalance).toBe("150000");
  });

  it("defaults the period to the current month", async () => {
    const { admin, savingId } = await seedLedger();

    const res = await request(app())
      .get(`/api/savings/${savingId}/statement`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    expect(res.status).toBe(200);
    expect(res.body.data.period.from).toBe(`${month}-01`);
    expect(res.body.data.period.to.startsWith(month)).toBe(true);
  });

  it("rejects a reversed or over-long period", async () => {
    const { admin, savingId } = await seedLedger();

    const reversed = await request(app())
      .get(`/api/savings/${savingId}/statement?from=2026-03-01&to=2026-02-01`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    const tooLong = await request(app())
      .get(`/api/savings/${savingId}/statement?from=2024-01-01&to=2026-02-01`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(reversed.status).toBe(422);
    expect(reversed.body.error.code).toBe("VALIDATION_ERROR");
    expect(tooLong.status).toBe(422);
  });

  it("does not expose another tenant's saving", async () => {
    const { savingId } = await seedLedger();
    const other = await setupTenant({ slug: "lain", registrationNo: "KOP-LAIN", adminEmail: "admin@lain.test" });

    const res = await request(app())
      .get(`/api/savings/${savingId}/statement`)
      .set("Authorization", `Bearer ${other.accessToken}`);

    expect(res.status).toBe(404);
  });

  it("exports the statement as CSV", async () => {
    const { admin, savingId } = await seedLedger();

    const res = await request(app())
      .get(`/api/savings/${savingId}/statement/csv?from=2026-02-01&to=2026-02-28`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("rekening-koran-");
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe("Tanggal,Jenis,Keterangan,Debit,Kredit,Saldo");
    expect(lines[1]).toBe("2026-02-01,,Saldo Awal,,,150000");
    expect(lines[2]).toBe("2026-02-05,Penarikan,,30000,0,120000");
    expect(lines[3]).toBe("2026-02-06,Bunga,,0,1250.5,121250.5");
    expect(lines[4]).toBe("2026-02-28,,Saldo Akhir,30000,1250.5,121250.5");
  });

  it("streams the statement as a PDF", async () => {
    const { admin, savingId } = await seedLedger();

    const res = await request(app())
      .get(`/api/savings/${savingId}/statement/pdf?from=2026-02-01&to=2026-02-28`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.length).toBeGreaterThan(1000);
  }, 20_000);
});
