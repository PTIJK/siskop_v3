import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

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

describe("POST /api/market/markets", () => {
  it("accepts a blank address (react-hook-form submits '' for an empty optional field, not undefined)", async () => {
    const admin = await setupTenant();

    const res = await createMarketAs(admin.accessToken, { address: "" });

    expect(res.status).toBe(201);
    expect(res.body.data.address).toBeNull();
  });

  it("creates a market and auto-creates a JASA unit for it", async () => {
    const admin = await setupTenant();

    const res = await createMarketAs(admin.accessToken);

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Pasar Induk");
    expect(res.body.data.unitId).toBeTruthy();

    const unit = await db.cooperativeUnit.findFirst({ where: { id: res.body.data.unitId, tenantId: admin.user.tenantId } });
    expect(unit?.type).toBe("JASA");
  });

  it("reuses the tenant's existing JASA unit for a second market instead of creating another", async () => {
    const admin = await setupTenant();
    const first = await createMarketAs(admin.accessToken, { name: "Pasar Induk" });
    const second = await createMarketAs(admin.accessToken, { name: "Pasar Malam" });

    expect(second.body.data.unitId).toBe(first.body.data.unitId);
    const jasaUnits = await db.cooperativeUnit.count({ where: { tenantId: admin.user.tenantId, type: "JASA" } });
    expect(jasaUnits).toBe(1);
  });

  it("rejects a duplicate market name within the same tenant", async () => {
    const admin = await setupTenant();
    await createMarketAs(admin.accessToken);

    const res = await createMarketAs(admin.accessToken);

    expect(res.status).toBe(409);
  });

  it("allows the same market name across two different tenants", async () => {
    const tenantA = await setupTenant({ slug: "pasar-a", registrationNo: "KOP-PASAR-A" });
    const tenantB = await setupTenant({ slug: "pasar-b", registrationNo: "KOP-PASAR-B" });

    const resA = await createMarketAs(tenantA.accessToken);
    const resB = await createMarketAs(tenantB.accessToken);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });
});

describe("GET /api/market/markets", () => {
  it("only returns the caller's own tenant's markets", async () => {
    const tenantA = await setupTenant({ slug: "pasar-a2", registrationNo: "KOP-PASAR-A2" });
    const tenantB = await setupTenant({ slug: "pasar-b2", registrationNo: "KOP-PASAR-B2" });
    await createMarketAs(tenantA.accessToken, { name: "Pasar A" });
    await createMarketAs(tenantB.accessToken, { name: "Pasar B" });

    const res = await request(app()).get("/api/market/markets").set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Pasar A");
  });
});

describe("PUT /api/market/markets/:id", () => {
  it("updates a market's name and address", async () => {
    const admin = await setupTenant();
    const created = await createMarketAs(admin.accessToken);

    const res = await request(app())
      .put(`/api/market/markets/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ address: "Jl. Pasar No. 1" });

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe("Jl. Pasar No. 1");
  });

  it("404s a market belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "pasar-a3", registrationNo: "KOP-PASAR-A3" });
    const tenantB = await setupTenant({ slug: "pasar-b3", registrationNo: "KOP-PASAR-B3" });
    const created = await createMarketAs(tenantA.accessToken);

    const res = await request(app())
      .put(`/api/market/markets/${created.body.data.id}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ address: "Nope" });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/market/stalls", () => {
  it("creates a stall under a market", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);

    const res = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: market.body.data.id, code: "A-01", block: "A", kind: "KIOS", areaM2: 4.5 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("AVAILABLE");
    expect(res.body.data.areaM2).toBe("4.5");
  });

  it("accepts a blank block (react-hook-form submits '' for an empty optional field, not undefined)", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);

    const res = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: market.body.data.id, code: "A-01", block: "", kind: "LAPAK" });

    expect(res.status).toBe(201);
    expect(res.body.data.block).toBeNull();
  });

  it("accepts a blank areaM2 (z.coerce.number() turns '' into 0 before .optional() can see it)", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);

    const res = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: market.body.data.id, code: "A-01", kind: "LAPAK", areaM2: "" });

    expect(res.status).toBe(201);
    expect(res.body.data.areaM2).toBeNull();
  });

  it("rejects a duplicate stall code within the same market", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: market.body.data.id, code: "A-01", kind: "KIOS" });

    const res = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: market.body.data.id, code: "A-01", kind: "LOS" });

    expect(res.status).toBe(409);
  });

  it("allows the same stall code in two different markets", async () => {
    const admin = await setupTenant();
    const marketA = await createMarketAs(admin.accessToken, { name: "Pasar A" });
    const marketB = await createMarketAs(admin.accessToken, { name: "Pasar B" });

    const resA = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: marketA.body.data.id, code: "A-01", kind: "KIOS" });
    const resB = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: marketB.body.data.id, code: "A-01", kind: "KIOS" });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("404s when the market doesn't exist for this tenant", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: "clnonexistentmarketid00", code: "A-01", kind: "KIOS" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/market/stalls", () => {
  it("filters by market, block, and status", async () => {
    const admin = await setupTenant();
    const marketA = await createMarketAs(admin.accessToken, { name: "Pasar A" });
    const marketB = await createMarketAs(admin.accessToken, { name: "Pasar B" });

    const stallA1 = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: marketA.body.data.id, code: "A-01", block: "A", kind: "KIOS" });
    await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: marketA.body.data.id, code: "B-01", block: "B", kind: "LOS" });
    await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: marketB.body.data.id, code: "A-01", block: "A", kind: "KIOS" });

    const byMarket = await request(app())
      .get(`/api/market/stalls?marketId=${marketA.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byMarket.body.data).toHaveLength(2);

    const byBlock = await request(app())
      .get(`/api/market/stalls?marketId=${marketA.body.data.id}&block=A`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byBlock.body.data).toHaveLength(1);
    expect(byBlock.body.data[0].code).toBe("A-01");

    await request(app())
      .put(`/api/market/stalls/${stallA1.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "OCCUPIED" });

    const byStatus = await request(app())
      .get(`/api/market/stalls?status=OCCUPIED`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(byStatus.body.data).toHaveLength(1);
    expect(byStatus.body.data[0].id).toBe(stallA1.body.data.id);
  });
});

describe("PUT /api/market/stalls/:id", () => {
  it("updates a stall's status", async () => {
    const admin = await setupTenant();
    const market = await createMarketAs(admin.accessToken);
    const stall = await request(app())
      .post("/api/market/stalls")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ marketId: market.body.data.id, code: "A-01", kind: "KIOS" });

    const res = await request(app())
      .put(`/api/market/stalls/${stall.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "INACTIVE" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("INACTIVE");
  });
});

describe("market permission on RBAC roles", () => {
  it("a Viewer can read markets but gets 403 creating one", async () => {
    const admin = await setupTenant();
    await createMarketAs(admin.accessToken, { name: "Pasar Induk" });
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.com");

    const readRes = await request(app()).get("/api/market/markets").set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.data).toHaveLength(1);

    const createRes = await createMarketAs(viewer.accessToken, { name: "Pasar Viewer" });
    expect(createRes.status).toBe(403);
  });

  it("a Kasir has no market access at all", async () => {
    const admin = await setupTenant();
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.com");

    const res = await request(app()).get("/api/market/markets").set("Authorization", `Bearer ${kasir.accessToken}`);
    expect(res.status).toBe(403);
  });
});
