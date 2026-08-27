import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, setupTenant, DEFAULT_MEMBER } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const DEFAULT_MEMBER_PASSWORD = "15031985";

async function activateMember(adminAccessToken: string, memberId: string, nik: string) {
  await request(app())
    .post(`/api/members/${memberId}/portal-access`)
    .set("Authorization", `Bearer ${adminAccessToken}`)
    .send();

  const login = await request(app())
    .post("/api/member-auth/login")
    .set("Host", "demo.localhost")
    .send({ nik, password: DEFAULT_MEMBER_PASSWORD });

  return login.body.data.accessToken as string;
}

async function createConfigAs(accessToken: string) {
  const res = await request(app())
    .post("/api/savings/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Simpanan Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
  return res.body.data as { id: string };
}

describe("GET /api/member/dashboard", () => {
  it("aggregates only the caller's own savings and active loans", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const config = await createConfigAs(admin.accessToken);
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, savingConfigId: config.id, initialDeposit: 250_000 });

    const accessToken = await activateMember(admin.accessToken, member.id, DEFAULT_MEMBER.nik);
    const res = await request(app()).get("/api/member/dashboard").set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalSavingsBalance).toBe("250000");
    expect(res.body.data.savingsAccountCount).toBe(1);
    expect(res.body.data.activeLoanCount).toBe(0);
  });
});

describe("member ownership isolation", () => {
  it("cannot fetch another member's saving by id", async () => {
    const admin = await setupTenant();
    const memberA = await createMemberAs(admin.accessToken, { nik: "1111111111111111" });
    const memberB = await createMemberAs(admin.accessToken, { nik: "2222222222222222" });
    const config = await createConfigAs(admin.accessToken);

    const savingB = await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: memberB.id, savingConfigId: config.id, initialDeposit: 100_000 });

    const tokenA = await activateMember(admin.accessToken, memberA.id, "1111111111111111");

    const res = await request(app())
      .get(`/api/member/savings/${savingB.body.data.id}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });

  it("cannot fetch another member's loan by id", async () => {
    const admin = await setupTenant();
    const memberA = await createMemberAs(admin.accessToken, { nik: "1111111111111111" });
    const memberB = await createMemberAs(admin.accessToken, { nik: "2222222222222222" });
    const pokokConfig = await request(app())
      .post("/api/savings/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Simpanan Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: memberB.id, savingConfigId: pokokConfig.body.data.id, initialDeposit: 500_000 });
    const loanConfig = await request(app())
      .post("/api/loans/configs")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "KUR Mikro", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
    const loanB = await request(app())
      .post("/api/loans")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: memberB.id, loanConfigId: loanConfig.body.data.id, principalAmount: 1_000_000, termMonths: 12 });

    const tokenA = await activateMember(admin.accessToken, memberA.id, "1111111111111111");

    const res = await request(app())
      .get(`/api/member/loans/${loanB.body.data.id}`)
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });

  it("lists only the caller's own savings, never another member's", async () => {
    const admin = await setupTenant();
    const memberA = await createMemberAs(admin.accessToken, { nik: "1111111111111111" });
    const memberB = await createMemberAs(admin.accessToken, { nik: "2222222222222222" });
    const config = await createConfigAs(admin.accessToken);
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: memberA.id, savingConfigId: config.id, initialDeposit: 10_000 });
    await request(app())
      .post("/api/savings")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: memberB.id, savingConfigId: config.id, initialDeposit: 20_000 });

    const tokenA = await activateMember(admin.accessToken, memberA.id, "1111111111111111");
    const res = await request(app()).get("/api/member/savings").set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].balance).toBe("10000");
  });
});
