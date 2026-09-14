import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { forbidden } from "../../lib/errors.js";

/** Authenticated proxy assertion. Forwarded-Host alone is never evidence of tenant identity. */
export function gatewayHost(req: Request, now = Date.now()): string | null {
  const host = req.get("x-siskop-host");
  const time = req.get("x-siskop-time");
  const signature = req.get("x-siskop-signature");
  if (!host && !time && !signature) return null;
  const secret = process.env.TENANT_GATEWAY_SECRET;
  if (!secret || secret.length < 32 || !host || !time || !/^\d{13}$/.test(time) || !signature ||
      Math.abs(now - Number(time)) > 30_000 || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw forbidden("Invalid workspace gateway");
  const expected = createHmac("sha256", secret).update([time, req.method, req.originalUrl, host].join("\n")).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw forbidden("Invalid workspace gateway");
  return host;
}
