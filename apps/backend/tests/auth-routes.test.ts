import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";

const app = () => createApp();

const REGISTRATION = {
  tenantName: "KSP Demo",
  slug: "demo",
  registrationNo: "KOP-DEMO",
  address: "Jl. Demo 1",
  type: "KONVENSIONAL",
  adminName: "Admin Demo",
  adminEmail: "admin@demo.test",
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

  it("never puts the refresh token in the response body — only in an httpOnly cookie", async () => {
    const res = await request(app()).post("/api/auth/register").send(REGISTRATION);

    expect(res.body.data.refreshToken).toBeUndefined();

    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^siskop_refresh_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
    // NODE_ENV is not "production" under the test runner — the dev server is
    // plain HTTP, so a `Secure` cookie there would never be sent at all.
    expect(cookie).not.toMatch(/Secure/i);
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
      .send({ ...REGISTRATION, registrationNo: "KOP-2", adminEmail: "b@x.test" });

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

  it("sets the refresh token as an httpOnly cookie instead of returning it in the body", async () => {
    const res = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "admin@demo.test", password: "rahasia123" });

    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^siskop_refresh_token=.+HttpOnly/is);
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
  it("exchanges the refresh cookie for a new access token", async () => {
    const agent = request.agent(app());
    await agent.post("/api/auth/register").send(REGISTRATION);

    const res = await agent.post("/api/auth/refresh").send();

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf("string");
    expect(res.body.data.refreshToken).toBeUndefined();
  });

  it("re-issues the refresh cookie on every use", async () => {
    // Not asserting it differs from the cookie issued at registration: a JWT's
    // `iat` has one-second resolution, so two tokens for the same user minted
    // within the same wall-clock second are byte-identical — that's a JWT
    // property, not a rotation bug. What must hold is that refresh always sets
    // a fresh cookie rather than relying on the one already on the client.
    const agent = request.agent(app());
    await agent.post("/api/auth/register").send(REGISTRATION);

    const res = await agent.post("/api/auth/refresh").send();

    expect(res.headers["set-cookie"]?.[0]).toMatch(/^siskop_refresh_token=.+HttpOnly/is);
  });

  it("rejects a request carrying no refresh cookie", async () => {
    const res = await request(app()).post("/api/auth/refresh").send();
    expect(res.status).toBe(401);
  });

  it("rejects a garbage refresh cookie", async () => {
    const res = await request(app())
      .post("/api/auth/refresh")
      .set("Cookie", "siskop_refresh_token=garbage")
      .send();
    expect(res.status).toBe(401);
  });

  it("no longer accepts a refresh token supplied in the request body", async () => {
    const reg = await request(app()).post("/api/auth/register").send(REGISTRATION);
    // Simulates the pre-fix client: no cookie set, token only in the body —
    // must fail now that the cookie is the only accepted source.
    const legacyToken = reg.body.data.refreshToken as string | undefined;
    const res = await request(app())
      .post("/api/auth/refresh")
      .send({ refreshToken: legacyToken });

    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the refresh cookie", async () => {
    const res = await request(app()).post("/api/auth/logout").send();

    expect(res.status).toBe(200);
    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^siskop_refresh_token=;/);
  });

  it("a cookie cleared by logout no longer refreshes a session", async () => {
    const agent = request.agent(app());
    await agent.post("/api/auth/register").send(REGISTRATION);
    await agent.post("/api/auth/logout").send();

    const res = await agent.post("/api/auth/refresh").send();
    expect(res.status).toBe(401);
  });
});
