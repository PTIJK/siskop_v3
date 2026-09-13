import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { unauthorized } from "../../lib/errors.js";
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

  router.post(
    "/run-daily",
    handle(async (req, res) => {
      verifySchedulerToken(req.get("x-scheduler-token"));
      const data = await runDailyScheduler();
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
