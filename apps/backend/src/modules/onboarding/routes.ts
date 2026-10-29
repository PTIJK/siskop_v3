import { Router, type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { ErrorCode } from "@siskop/types";
import { forbidden } from "../../lib/errors.js";
import { clearRefreshCookie, setRefreshCookie } from "../auth/refresh-cookie.js";
import { selectionEnabled } from "../tenant-access/config.js";
import { trustedRequestOrigin } from "../tenant-domains/middleware.js";
import { clearRegistrationCookie, setRegistrationCookie, tenantFromRegistrationCookie } from "./cookie.js";
import { firebaseSignIn, register, status } from "./service.js";

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

function limiter(limit: number, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: ErrorCode.RATE_LIMIT, message: "Terlalu banyak percobaan. Coba lagi sebentar." },
        meta: res.locals.meta
      });
    }
  });
}

/**
 * Public registration and the pre-activation status page. Prices come from
 * GET /api/public/pricing; payment is confirmed by the platform owner
 * (see docs/package-modules/PRICING-V2-IMPLEMENTATION-SPEC.md section 7 and 8).
 */
export function onboardingRoutes(): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use((req, _res, next) => {
    if (req.method !== "GET") {
      if (!req.is("application/json")) {
        next(forbidden("JSON required"));
        return;
      }
      const origin = req.get("origin");
      const allowed = [trustedRequestOrigin(req), process.env.PUBLIC_APP_URL, ...(process.env.CORS_ORIGIN ?? "").split(",")]
        .filter(Boolean)
        .map((url) => {
          try {
            return new URL(url!).origin;
          } catch {
            return "";
          }
        });
      if (origin && !allowed.includes(origin)) {
        next(forbidden("Origin not allowed"));
        return;
      }
    }
    next();
  });

  router.post(
    "/register",
    limiter(10, 15 * 60_000),
    handle(async (req, res) => {
      const tenantId = await register(req.body);
      setRegistrationCookie(res, tenantId);
      res.status(201).json({ success: true, data: await status(tenantId), meta: res.locals.meta });
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
