import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";

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

async function createLevyRateAs(accessToken: string, marketId: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app())
    .post("/api/market/levy-rates")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ marketId, stallKind: "KIOS", name: "Kebersihan", amount: 5000, ...overrides });
  return res;
}

describe("POST /api/market/levy-rates", () => {
  it("creates a levy rate defaulting to DAILY", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);

    const res = await createLevyRateAs(admin.accessToken, market.body.data.id);

    expect(res.status).toBe(201);
    expect(res.body.data.period).toBe("DAILY");
    expect(res.body.data.amount).toBe("5000");
    expect(res.body.data.isActive).toBe(true);
  });

  it("allows several active rates on the same market + stall kind (Kebersihan + Keamanan)", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    await createLevyRateAs(admin.accessToken, market.body.data.id, { name: "Kebersihan" });

    const res = await createLevyRateAs(admin.accessToken, market.body.data.id, { name: "Keamanan" });

    expect(res.status).toBe(201);
  });

  it("404s when the market doesn't exist for this tenant", async () => {
    const admin = await setupTenant();

    const res = await createLevyRateAs(admin.accessToken, "clnonexistentmarketid00");

    expect(res.status).toBe(404);
  });
});

describe("GET /api/market/levy-rates", () => {
  it("filters by marketId and stallKind, only for the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "pasar-la", registrationNo: "KOP-PASAR-LA" });
    const tenantB = await setupTenant({ slug: "pasar-lb", registrationNo: "KOP-PASAR-LB" });
    const marketA = await createMarketAs(tenantA.accessToken);
    const marketB = await createMarketAs(tenantB.accessToken);
    await createLevyRateAs(tenantA.accessToken, marketA.body.data.id, { stallKind: "KIOS" });
    await createLevyRateAs(tenantA.accessToken, marketA.body.data.id, { stallKind: "LOS", name: "Keamanan" });
    await createLevyRateAs(tenantB.accessToken, marketB.body.data.id, { stallKind: "KIOS" });

    const res = await request(app())
      .get(`/api/market/levy-rates?marketId=${marketA.body.data.id}&stallKind=KIOS`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Kebersihan");
  });
});

describe("PUT /api/market/levy-rates/:id", () => {
  it("updates amount and can deactivate a rate", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const created = await createLevyRateAs(admin.accessToken, market.body.data.id);

    const res = await request(app())
      .put(`/api/market/levy-rates/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 7500, isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe("7500");
    expect(res.body.data.isActive).toBe(false);
  });

  it("404s a levy rate belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "pasar-lc", registrationNo: "KOP-PASAR-LC" });
    const tenantB = await setupTenant({ slug: "pasar-ld", registrationNo: "KOP-PASAR-LD" });
    const market = await createMarketAs(tenantA.accessToken);
    const created = await createLevyRateAs(tenantA.accessToken, market.body.data.id);

    const res = await request(app())
      .put(`/api/market/levy-rates/${created.body.data.id}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ amount: 1 });

    expect(res.status).toBe(404);
  });
});
