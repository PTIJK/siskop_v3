import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { schedulerRoutes } from "../src/modules/scheduler/routes.js";
import { runDailyScheduler } from "../src/modules/scheduler/service.js";
import { identityProvisioner } from "../src/modules/identity-provisioning/service.js";

vi.mock("../src/modules/scheduler/service.js", () => ({ runDailyScheduler: vi.fn() }));
vi.mock("../src/modules/identity-provisioning/service.js", () => ({ identityProvisioner: { reconcile: vi.fn() } }));

function app() {
  const server = express();
  server.use("/api/scheduler", schedulerRoutes());
  server.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ success: false });
  });
  return server;
}
beforeEach(() => {
  vi.stubEnv("SCHEDULER_SECRET", "scheduler-test-only");
  vi.stubEnv("FIREBASE_ACCOUNT_PROVISIONING_ENABLED", "true");
  vi.stubEnv("K_REVISION", "candidate-revision");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("scheduled job HTTP contracts", () => {
  it.each(["/status", "/reconcile-identities"])("protects %s before doing any work", async path => {
    const server = app();
    for (const token of [undefined, "bad", "x".repeat(19)]) {
      const call = path === "/status" ? request(server).get(`/api/scheduler${path}`) : request(server).post(`/api/scheduler${path}`);
      if (token) call.set("x-scheduler-token", token);
      expect((await call).status).toBe(401);
    }
    expect(identityProvisioner.reconcile).not.toHaveBeenCalled();
    expect(runDailyScheduler).not.toHaveBeenCalled();
  });

  it("readiness reports the serving revision without running either job", async () => {
    const response = await request(app()).get("/api/scheduler/status").set("x-scheduler-token", "scheduler-test-only");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ version: 1, revision: "candidate-revision", daily: true, identityRecovery: true });
    expect(identityProvisioner.reconcile).not.toHaveBeenCalled();
    expect(runDailyScheduler).not.toHaveBeenCalled();
  });

  it("runs Firebase recovery independently of financial accrual", async () => {
    vi.mocked(identityProvisioner.reconcile).mockResolvedValue({ linked: 2, removed: 1 });
    const response = await request(app()).post("/api/scheduler/reconcile-identities").set("x-scheduler-token", "scheduler-test-only");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ linked: 2, removed: 1 });
    expect(identityProvisioner.reconcile).toHaveBeenCalledOnce();
    expect(runDailyScheduler).not.toHaveBeenCalled();
  });

  it("fails closed when Firebase provisioning is disabled", async () => {
    vi.stubEnv("FIREBASE_ACCOUNT_PROVISIONING_ENABLED", "false");
    const server = app();
    const response = await request(server).post("/api/scheduler/reconcile-identities").set("x-scheduler-token", "scheduler-test-only");
    expect(response.status).toBe(503);
    const status = await request(server).get("/api/scheduler/status").set("x-scheduler-token", "scheduler-test-only");
    expect(status.body.data.identityRecovery).toBe(false);
    expect(identityProvisioner.reconcile).not.toHaveBeenCalled();
  });

  it("makes partial daily failures retryable and keeps the result counts", async () => {
    vi.mocked(runDailyScheduler).mockResolvedValue({ date: new Date().toISOString(), savingsInterest: { checked: 3, posted: 2, skipped: 0, failed: 1 }, loanKol: { checked: 1, failed: 0 } });
    const response = await request(app()).post("/api/scheduler/run-daily").set("x-scheduler-token", "scheduler-test-only");
    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body.data.savingsInterest.failed).toBe(1);
  });

  it("returns a non-success status when Firebase recovery fails", async () => {
    vi.mocked(identityProvisioner.reconcile).mockRejectedValue(new Error("provider unavailable"));
    const response = await request(app()).post("/api/scheduler/reconcile-identities").set("x-scheduler-token", "scheduler-test-only");
    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });
});
