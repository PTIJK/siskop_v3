import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { ErrorCode, type ApiResponse, type SchedulerStatus } from "@siskop/types";
import { unauthorized } from "../../lib/errors.js";
import { identityProvisioner } from "../identity-provisioning/service.js";
import { runDailyScheduler } from "./service.js";

/**
 * Machine-to-machine auth, not a user session: this endpoint is meant to be
 * called by an external scheduler (OS-level cron / Windows Task Scheduler /
 * a host's job scheduler in production) with no logged-in user available.
 * Same shared-secret-header shape as modules/onboarding/xendit.ts's Xendit
 * webhook token — see SCHEDULER_SECRET in .env.example.
 */
function verifySchedulerToken(token: string | undefined): void {
  const expected = process.env.SCHEDULER_SECRET;
  if (
    !expected ||
    !token ||
    Buffer.byteLength(expected) !== Buffer.byteLength(token) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  ) {
    throw unauthorized("Invalid scheduler token");
  }
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function schedulerRoutes(): Router {
  const router = Router();
  router.use((req, _res, next) => {
    try { verifySchedulerToken(req.get("x-scheduler-token")); next(); }
    catch (error) { next(error); }
  });

  // A read-only release probe: checking readiness must never accrue money or
  // delete an external identity. K_REVISION identifies the actual serving code.
  router.get("/status", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      success: true,
      data: { version: 1, revision: process.env.K_REVISION ?? "local", daily: true, identityRecovery: process.env.FIREBASE_ACCOUNT_PROVISIONING_ENABLED === "true" },
      meta: res.locals.meta
    } satisfies ApiResponse<SchedulerStatus>);
  });

  router.post(
    "/run-daily",
    handle(async (req, res) => {
      const data = await runDailyScheduler();
      const failed = data.savingsInterest.failed > 0 || data.loanKol.failed > 0 || data.auditThreshold.failed > 0;
      res.status(failed ? 503 : 200).json({
        success: !failed, data, meta: res.locals.meta,
        ...(failed ? { error: { code: ErrorCode.INTERNAL_ERROR, message: "Some daily calculations failed; retry this job." } } : {})
      } satisfies ApiResponse<typeof data>);
    })
  );

  router.post("/reconcile-identities", handle(async (_req, res) => {
    if (process.env.FIREBASE_ACCOUNT_PROVISIONING_ENABLED !== "true") {
      res.status(503).json({ success: false, error: { code: ErrorCode.INTERNAL_ERROR, message: "Firebase account provisioning is disabled." }, meta: res.locals.meta } satisfies ApiResponse<never>);
      return;
    }
    const data = await identityProvisioner.reconcile();
    res.json({ success: true, data, meta: res.locals.meta } satisfies ApiResponse<typeof data>);
  }));

  return router;
}
