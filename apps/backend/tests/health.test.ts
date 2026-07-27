import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns ok with a timestamp", async () => {
    const res = await request(createApp()).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
    expect(typeof res.body.data.timestamp).toBe("string");
  });

  // The frontend's apiFetch prefixes /api and the Vite proxy forwards that
  // prefix as-is, so the shell's status card hits /api/health, not /health.
  it("is also reachable under the /api prefix the frontend client uses", async () => {
    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ok");
  });

  it("returns a structured 404 for unknown routes", async () => {
    const res = await request(createApp()).get("/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
