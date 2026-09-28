import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

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
    .send({ stallId, memberId, startDate: "2026-09-01", rentAmount: 500000, rentPeriod: "MONTHLY", ...overrides });
  return res;
}

describe("POST /api/market/contracts", () => {
  it("creates a contract and sets the stall to OCCUPIED", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const member = await createMemberAs(admin.accessToken);

    const res = await createContractAs(admin.accessToken, stall.body.data.id, member.id);

    expect(res.status).toBe(201);
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.rentAmount).toBe("500000");

    const updatedStall = await db.stall.findFirst({ where: { id: stall.body.data.id, tenantId: admin.user.tenantId } });
    expect(updatedStall?.status).toBe("OCCUPIED");
  });

  it("rejects a second active contract on a stall that already has one", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const memberA = await createMemberAs(admin.accessToken, { nik: "3171234567890001" });
    const memberB = await createMemberAs(admin.accessToken, { nik: "3171234567890002" });
    await createContractAs(admin.accessToken, stall.body.data.id, memberA.id);

    const res = await createContractAs(admin.accessToken, stall.body.data.id, memberB.id);

    expect(res.status).toBe(409);
  });

  it("allows a new contract once the previous one has ended", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const memberA = await createMemberAs(admin.accessToken, { nik: "3171234567890001" });
    const memberB = await createMemberAs(admin.accessToken, { nik: "3171234567890002" });
    const first = await createContractAs(admin.accessToken, stall.body.data.id, memberA.id);

    await request(app())
      .post(`/api/market/contracts/${first.body.data.id}/end`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({});

    const res = await createContractAs(admin.accessToken, stall.body.data.id, memberB.id);
    expect(res.status).toBe(201);
  });

  it("404s when the stall doesn't exist for this tenant", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);

    const res = await createContractAs(admin.accessToken, "clnonexistentstallid00", member.id);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/market/contracts/:id/end", () => {
  it("ends a contract and frees up the stall", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await createStallAs(admin.accessToken, market.body.data.id);
    const member = await createMemberAs(admin.accessToken);
    const contract = await createContractAs(admin.accessToken, stall.body.data.id, member.id);

    const res = await request(app())
      .post(`/api/market/contracts/${contract.body.data.id}/end`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect(res.body.data.endDate).toBeTruthy();

    const updatedStall = await db.stall.findFirst({ where: { id: stall.body.data.id, tenantId: admin.user.tenantId } });
    expect(updatedStall?.status).toBe("AVAILABLE");
  });

  it("404s a contract belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "pasar-ca", registrationNo: "KOP-PASAR-CA" });
    const tenantB = await setupTenant({ slug: "pasar-cb", registrationNo: "KOP-PASAR-CB" });
    const market = await createMarketAs(tenantA.accessToken);
    const stall = await createStallAs(tenantA.accessToken, market.body.data.id);
    const member = await createMemberAs(tenantA.accessToken);
    const contract = await createContractAs(tenantA.accessToken, stall.body.data.id, member.id);

    const res = await request(app())
      .post(`/api/market/contracts/${contract.body.data.id}/end`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe("GET /api/market/contracts", () => {
  it("filters by stallId, memberId, and isActive", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stallA = await createStallAs(admin.accessToken, market.body.data.id, { code: "A-01" });
    const stallB = await createStallAs(admin.accessToken, market.body.data.id, { code: "B-01" });
    const memberA = await createMemberAs(admin.accessToken, { nik: "3171234567890001" });
    const memberB = await createMemberAs(admin.accessToken, { nik: "3171234567890002" });
    const contractA = await createContractAs(admin.accessToken, stallA.body.data.id, memberA.id);
    await createContractAs(admin.accessToken, stallB.body.data.id, memberB.id);
    await request(app())
      .post(`/api/market/contracts/${contractA.body.data.id}/end`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({});

    const byStall = await request(app())
      .get(`/api/market/contracts?stallId=${stallB.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byStall.body.data).toHaveLength(1);

    const byMember = await request(app())
      .get(`/api/market/contracts?memberId=${memberA.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byMember.body.data).toHaveLength(1);

    const active = await request(app())
      .get(`/api/market/contracts?isActive=true`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(active.body.data).toHaveLength(1);
    expect(active.body.data[0].stallId).toBe(stallB.body.data.id);
  });
});
