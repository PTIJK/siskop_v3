import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { forbidden } from "../lib/errors.js";
import { gatewayHost } from "../modules/tenant-domains/gateway.js";

/** Browser traffic must arrive through one authenticated SISKOP gateway. */
export const contaboIngress: RequestHandler = (req, _res, next) => {
  try {
    if (["/health", "/api/health"].includes(req.path) || req.path.startsWith("/api/scheduler/") ||
        req.path === "/api/onboarding/webhook") { next(); return; }
    if (gatewayHost(req)) { next(); return; }
    const time = req.get("x-siskop-central-time");
    const signature = req.get("x-siskop-central-signature");
    const secret = process.env.CENTRAL_GATEWAY_SECRET;
    if (!secret || secret.length < 32 || !time || !/^\d{13}$/.test(time) ||
        Math.abs(Date.now() - Number(time)) > 30_000 || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
      throw forbidden("SISKOP gateway required");
    }
    const expected = createHmac("sha256", secret).update(["central", time, req.method, req.originalUrl].join("\n")).digest();
    if (!timingSafeEqual(Buffer.from(signature, "base64url"), expected)) throw forbidden("Invalid SISKOP gateway");
    next();
  } catch (error) { next(error); }
};
