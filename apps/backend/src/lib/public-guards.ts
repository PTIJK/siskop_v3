import type { Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { ErrorCode } from "@siskop/types";
import { trustedRequestOrigin } from "../modules/tenant-domains/middleware.js";
import { forbidden } from "./errors.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
export function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

export function limiter(limit: number, windowMs = 60_000) {
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

/** For public, cookie-less POST routes: no caching, JSON bodies only, and a browser Origin we recognise. */
export function publicJsonGuard() {
  return [
    (_req: Request, res: Response, next: NextFunction) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    (req: Request, _res: Response, next: NextFunction) => {
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
    }
  ];
}
