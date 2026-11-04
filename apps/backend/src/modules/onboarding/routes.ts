import { Router } from "express";
import { forbidden } from "../../lib/errors.js";
import { handle, limiter, publicJsonGuard } from "../../lib/public-guards.js";
import { clearRefreshCookie, setRefreshCookie } from "../auth/refresh-cookie.js";
import { selectionEnabled } from "../tenant-access/config.js";
import { clearRegistrationCookie, setRegistrationCookie, tenantFromRegistrationCookie } from "./cookie.js";
import { checkReferralCode, firebaseSignIn, register, status } from "./service.js";

/**
 * Public registration and the pre-activation status page. Prices come from
 * GET /api/public/pricing; payment is confirmed by the platform owner
 * (see docs/package-modules/PRICING-V2-IMPLEMENTATION-SPEC.md section 7 and 8).
 */
export function onboardingRoutes(): Router {
  const router = Router();
  router.use(...publicJsonGuard());

  router.post(
    "/register",
    limiter(10, 15 * 60_000),
    handle(async (req, res) => {
      const tenantId = await register(req.body);
      setRegistrationCookie(res, tenantId);
      res.status(201).json({ success: true, data: await status(tenantId), meta: res.locals.meta });
    })
  );

  router.get(
    "/referral/:code",
    limiter(10, 15 * 60_000),
    handle(async (req, res) => {
      res.json({ success: true, data: await checkReferralCode(String(req.params.code).slice(0, 40)), meta: res.locals.meta });
    })
  );

  for (const path of ["/login", "/firebase-resume"]) {
    router.post(
      path,
      limiter(10, 15 * 60_000),
      handle(async (req, res) => {
        if (selectionEnabled() && !req.workspace && path === "/login") throw forbidden("Gunakan halaman masuk terbaru untuk memilih koperasi.");
        const result = await firebaseSignIn(req.body, path === "/firebase-resume", req.workspace?.tenantId);
        if (result.next === "awaiting_payment") {
          clearRefreshCookie(res);
          setRegistrationCookie(res, result.tenantId);
          res.json({ success: true, data: { next: result.next, status: result.status }, meta: res.locals.meta });
        } else {
          const { refreshToken, ...session } = result.session;
          setRefreshCookie(res, refreshToken);
          clearRegistrationCookie(res);
          res.json({ success: true, data: { next: "dashboard", session }, meta: res.locals.meta });
        }
      })
    );
  }

  router.get(
    "/status",
    limiter(60),
    handle(async (req, res) => {
      res.json({ success: true, data: await status(tenantFromRegistrationCookie(req)), meta: res.locals.meta });
    })
  );

  return router;
}
