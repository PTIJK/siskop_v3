import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contaboIngress } from "../src/hosting/contabo-ingress.js";

const secret = "test-central-gateway-secret-32-characters";
function app() {
  const server = express();
  server.use(contaboIngress);
  server.all("*", (_req, res) => res.sendStatus(204));
  server.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(403));
  return server;
}
afterEach(() => vi.unstubAllEnvs());
describe("Contabo browser ingress", () => {
  it("rejects direct and forged browser requests", async () => {
    vi.stubEnv("CENTRAL_GATEWAY_SECRET", secret);
    expect((await request(app()).get("/api/dashboard")).status).toBe(403);
    expect((await request(app()).get("/api/dashboard").set("x-forwarded-host", "siskop-d0f8c.web.app")).status).toBe(403);
  });
  it("binds central assertions to method, path, query and time", async () => {
    vi.stubEnv("CENTRAL_GATEWAY_SECRET", secret);
    const time = String(Date.now());
    const signature = createHmac("sha256", secret).update(["central", time, "GET", "/api/dashboard?a=1"].join("\n")).digest("base64url");
    for (const [url, expected] of [["/api/dashboard?a=1", 204], ["/api/dashboard?a=2", 403]] as const) {
      expect((await request(app()).get(url).set("x-siskop-central-time", time).set("x-siskop-central-signature", signature)).status).toBe(expected);
    }
    const old = String(Date.now() - 60_000);
    const stale = createHmac("sha256", secret).update(["central", old, "GET", "/api/dashboard"].join("\n")).digest("base64url");
    expect((await request(app()).get("/api/dashboard").set("x-siskop-central-time", old).set("x-siskop-central-signature", stale)).status).toBe(403);
  });
  it("leaves health, scheduler and exact payment callback to their own handlers", async () => {
    for (const path of ["/health", "/api/scheduler/status", "/api/onboarding/webhook"])
      expect((await request(app()).get(path)).status).toBe(204);
    expect((await request(app()).get("/api/onboarding/webhook-other")).status).toBe(403);
  });
});
