import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { verifyAccessToken, signAccessToken, requireAuth } from "../src/middleware/auth.js";

const SECRET = "test-secret";

const CLAIMS = {
  userId: "u1",
  tenantId: "t1",
  role: "member",
  unitIds: ["un1", "un2"],
  roleId: "r1",
  permissions: {
    dashboard: { read: true },
    members: { create: false, read: true, update: false, delete: false },
    savings: {},
    loans: {},
    reports: {},
    config: {},
    users: {},
    roles: {}
  }
} as const;

describe("access token", () => {
  it("round-trips claims", () => {
    const token = signAccessToken({ ...CLAIMS, unitIds: [...CLAIMS.unitIds] }, SECRET, "15m");
    expect(verifyAccessToken(token, SECRET)).toMatchObject(CLAIMS);
  });

  it("rejects a token signed with a different secret", () => {
    const forged = jwt.sign(CLAIMS, "wrong-secret");
    expect(() => verifyAccessToken(forged, SECRET)).toThrow();
  });

  it("rejects a token missing tenantId", () => {
    const bad = jwt.sign({ userId: "u1", role: "member", unitIds: ["un1"] }, SECRET);
    expect(() => verifyAccessToken(bad, SECRET)).toThrow(/tenantId/);
  });

  // An empty array is a bug, not a state to handle downstream: a user with
  // access to no unit cannot do anything useful, so it is rejected at verify
  // time rather than surfacing as an empty result set in a repository.
  it("rejects a token with no unit access", () => {
    const bad = jwt.sign({ ...CLAIMS, unitIds: [] }, SECRET);
    expect(() => verifyAccessToken(bad, SECRET)).toThrow(/unitIds/);
  });

  it("rejects a token whose unitIds claim is absent entirely", () => {
    const bad = jwt.sign({ userId: "u1", tenantId: "t1", role: "member" }, SECRET);
    expect(() => verifyAccessToken(bad, SECRET)).toThrow(/unitIds/);
  });
});

describe("requireAuth", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  // Echoes back whatever requireAuth attached, so the tests can assert on the
  // tenant claim the rest of the app will scope its queries by.
  function appWithGuard() {
    const app = express();
    app.get("/private", requireAuth, (req, res) => {
      res.json({ success: true, data: req.auth });
    });
    return app;
  }

  it("rejects a request with no Authorization header", async () => {
    const res = await request(appWithGuard()).get("/private");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.body.error.message).toMatch(/missing bearer token/i);
  });

  it("rejects a non-Bearer Authorization scheme", async () => {
    const res = await request(appWithGuard())
      .get("/private")
      .set("Authorization", "Basic dXNlcjpwYXNz");

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/missing bearer token/i);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = jwt.sign(CLAIMS, "wrong-secret");
    const res = await request(appWithGuard()).get("/private").set("Authorization", `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid or expired/i);
  });

  it("rejects an expired token", async () => {
    const expired = signAccessToken({ ...CLAIMS, unitIds: [...CLAIMS.unitIds] }, SECRET, "-1s");
    const res = await request(appWithGuard()).get("/private").set("Authorization", `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid or expired/i);
  });

  it("rejects a validly-signed token that carries no tenantId", async () => {
    const noTenant = jwt.sign({ userId: "u1", role: "member", unitIds: ["un1"] }, SECRET);
    const res = await request(appWithGuard()).get("/private").set("Authorization", `Bearer ${noTenant}`);

    expect(res.status).toBe(401);
  });

  it("rejects a validly-signed token that grants no unit", async () => {
    const noUnits = jwt.sign({ ...CLAIMS, unitIds: [] }, SECRET);
    const res = await request(appWithGuard()).get("/private").set("Authorization", `Bearer ${noUnits}`);

    expect(res.status).toBe(401);
  });

  it("admits a valid token and exposes its claims on req.auth", async () => {
    const token = signAccessToken({ ...CLAIMS, unitIds: [...CLAIMS.unitIds] }, SECRET, "15m");
    const res = await request(appWithGuard()).get("/private").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject(CLAIMS);
  });
});
