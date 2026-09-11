import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { ErrorCode } from "@siskop/types";
import { forbidden, unauthorized } from "../../lib/errors.js";
import { setRefreshCookie, clearRefreshCookie } from "../auth/refresh-cookie.js";
import { catalog, register, resume, status, checkout, reconcile, complete, handleSessionWebhook, firebaseSignIn } from "./service.js";
import { paymentSessionWebhookDataSchema } from "./schema.js";
import { verifyCallbackToken } from "./xendit.js";

const COOKIE = "siskop_onboarding";
const COOKIE_PATH = "/api/onboarding";
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: COOKIE_PATH,
  maxAge: 7 * 24 * 60 * 60 * 1000
});
function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is required");
  return value;
}
function setOrderCookie(res: Response, orderId: string) {
  res.cookie(
    COOKIE,
    jwt.sign({ orderId, typ: "onboarding" }, secret(), { expiresIn: "7d", audience: "siskop-onboarding" }),
    cookieOptions()
  );
}
function orderFrom(req: Request): string {
  try {
    const token: unknown = req.cookies?.[COOKIE];
    if (typeof token !== "string") throw new Error();
    const parsed = z
      .object({ orderId: z.string().min(1), typ: z.literal("onboarding") })
      .parse(jwt.verify(token, secret(), { audience: "siskop-onboarding" }));
    return parsed.orderId;
  } catch {
    throw unauthorized("Lanjutkan pendaftaran untuk mengakses pembayaran");
  }
}
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
export function onboardingRoutes(): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get(
    "/packages",
    handle(async (_req, res) => {
      res.json({ success: true, data: await catalog(), meta: res.locals.meta });
    })
  );
  router.post(
    "/webhook",
    handle(async (req, res) => {
      verifyCallbackToken(req.get("x-callback-token"));
      const event = z.object({ event: z.string() }).parse(req.body);
      if (["payment_session.completed", "payment_session.expired"].includes(event.event)) {
        const data = paymentSessionWebhookDataSchema.parse(req.body.data);
        await handleSessionWebhook(data.referenceId, data.sessionId);
      }
      res.json({ success: true, data: { received: true }, meta: res.locals.meta });
    })
  );
  router.use((req, _res, next) => {
    if (req.method !== "GET") {
      if (!req.is("application/json")) {
        next(forbidden("JSON required"));
        return;
      }
      const origin = req.get("origin");
      const allowed = [process.env.PUBLIC_APP_URL, ...(process.env.CORS_ORIGIN ?? "").split(",")]
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
      const id = await register(req.body);
      setOrderCookie(res, id);
      res.status(201).json({ success: true, data: await status(id), meta: res.locals.meta });
    })
  );
  for (const path of ["/login", "/firebase-resume"]) {
    router.post(path, limiter(10, 15 * 60_000), handle(async (req, res) => {
      const result = await firebaseSignIn(req.body, path === "/firebase-resume");
      if (result.next === "checkout") {
        clearRefreshCookie(res);
        setOrderCookie(res, result.order.id);
        res.json({ success: true, data: result, meta: res.locals.meta });
      } else {
        const { refreshToken, ...session } = result.session;
        setRefreshCookie(res, refreshToken);
        res.clearCookie(COOKIE, { path: COOKIE_PATH });
        res.json({ success: true, data: { next: "dashboard", session }, meta: res.locals.meta });
      }
    }));
  }
  router.post(
    "/resume",
    limiter(10, 15 * 60_000),
    handle(async (req, res) => {
      const id = await resume(req.body);
      setOrderCookie(res, id);
      res.json({ success: true, data: await status(id), meta: res.locals.meta });
    })
  );
  router.get(
    "/status",
    limiter(60),
    handle(async (req, res) => {
      res.json({ success: true, data: await status(orderFrom(req)), meta: res.locals.meta });
    })
  );
  router.post(
    "/checkout",
    limiter(10),
    handle(async (req, res) => {
      res.json({ success: true, data: await checkout(orderFrom(req)), meta: res.locals.meta });
    })
  );
  router.post(
    "/reconcile",
    limiter(10),
    handle(async (req, res) => {
      res.json({ success: true, data: await reconcile(orderFrom(req)), meta: res.locals.meta });
    })
  );
  router.post(
    "/complete",
    limiter(10),
    handle(async (req, res) => {
      const result = await complete(orderFrom(req));
      clearRefreshCookie(res);
      res.clearCookie(COOKIE, { path: COOKIE_PATH });
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );
  return router;
}
