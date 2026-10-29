import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { unauthorized } from "../../lib/errors.js";

export const REGISTRATION_COOKIE = "siskop_onboarding";
export const REGISTRATION_COOKIE_PATH = "/api/onboarding";
const AUDIENCE = "siskop-onboarding";

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is required");
  return value;
}

/**
 * The registration cookie carries a signed tenant id. It is only a pointer to
 * the status page of a koperasi that is not active yet, so it grants no access
 * beyond reading that status. Never store a bare id here.
 */
export function setRegistrationCookie(res: Response, tenantId: string): void {
  res.cookie(REGISTRATION_COOKIE, jwt.sign({ tenantId, typ: "onboarding" }, secret(), { expiresIn: "7d", audience: AUDIENCE }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: REGISTRATION_COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function clearRegistrationCookie(res: Response): void {
  res.clearCookie(REGISTRATION_COOKIE, { path: REGISTRATION_COOKIE_PATH });
}

export function tenantFromRegistrationCookie(req: Request): string {
  try {
    const token: unknown = req.cookies?.[REGISTRATION_COOKIE];
    if (typeof token !== "string") throw new Error("missing");
    const parsed = z
      .object({ tenantId: z.string().min(1), typ: z.literal("onboarding") })
      .parse(jwt.verify(token, secret(), { audience: AUDIENCE }));
    return parsed.tenantId;
  } catch {
    throw unauthorized("Lanjutkan pendaftaran untuk melihat status pembayaran");
  }
}
