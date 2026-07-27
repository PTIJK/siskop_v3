import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";

const app = () => createApp();

const REGISTRATION = {
  tenantName: "KSP Demo",
  slug: "demo",
  cooperativeId: "KOP-DEMO",
  address: "Jl. Demo 1",
  adminName: "Admin Demo",
  adminEmail: "admin@demo.test",
  adminPhone: "0812000000",
  password: "rahasia123",
  firstUnit: { type: "KSP", name: "Simpan Pinjam" }
};

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("POST /api/auth/register", () => {
  it("creates the cooperative and returns a session in the envelope", async () => {
    const res = await request(app()).post("/api/auth/register").send(REGISTRATION);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe("admin@demo.test");
    expect(res.body.data.accessToken).toBeTypeOf("string");
    expect(res.body.meta.requestId).toBeTypeOf("string");
  });

  it("rejects a short password with VALIDATION_ERROR, not a 500", async () => {
    const res = await request(app())
      .post("/api/auth/register")
      .send({ ...REGISTRATION, password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("reports a duplicate slug as CONFLICT", async () => {
    await request(app()).post("/api/auth/register").send(REGISTRATION);
    const res = await request(app())
      .post("/api/auth/register")
      .send({ ...REGISTRATION, cooperativeId: "KOP-2", adminEmail: "b@x.test" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await request(app()).post("/api/auth/register").send(REGISTRATION);
  });

  it("authenticates against the tenant named by the Host subdomain", async () => {
    const res = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "admin@demo.test", password: "rahasia123" });

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe("Admin Demo");
  });

  it("never puts the password hash on the wire", async () => {
    const res = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "admin@demo.test", password: "rahasia123" });

    expect(JSON.stringify(res.body)).not.toContain("$2");
  });

  it("rejects a wrong password with 401 and the UNAUTHORIZED code", async () => {
    const res = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "admin@demo.test", password: "salah" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("tells the caller when no cooperative subdomain was supplied", async () => {
    const res = await request(app())
      .post("/api/auth/login")
      .set("Host", "localhost")
      .send({ email: "admin@demo.test", password: "rahasia123" });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/subdomain/i);
  });
});

describe("GET /api/auth/me", () => {
  it("returns the caller's own user for a valid token", async () => {
    const reg = await request(app()).post("/api/auth/register").send(REGISTRATION);
    const res = await request(app())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${reg.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("admin@demo.test");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app()).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/refresh", () => {
  it("exchanges a refresh token for a new pair", async () => {
    const reg = await request(app()).post("/api/auth/register").send(REGISTRATION);
    const res = await request(app())
      .post("/api/auth/refresh")
      .send({ refreshToken: reg.body.data.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf("string");
  });

  it("rejects a garbage refresh token", async () => {
    const res = await request(app()).post("/api/auth/refresh").send({ refreshToken: "nope" });
    expect(res.status).toBe(401);
  });
});
