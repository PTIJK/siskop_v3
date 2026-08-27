import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { ErrorCode, type MemberAuthClaims } from "@siskop/types";
import { unauthorized as unauthorizedError } from "../lib/errors.js";

const memberClaimsSchema = z.object({
  memberId: z.string().min(1),
  tenantId: z.string().min(1),
  role: z.literal("member")
});

// A staff AuthClaims token has `userId`, not `memberId`, so it fails this
// schema (and vice versa for `claimsSchema` in middleware/auth.ts) — the two
// session types reject each other's tokens without any explicit cross-guard.
export function signMemberAccessToken(claims: MemberAuthClaims, secret: string, expiresIn: string): string {
  return jwt.sign(claims, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyMemberAccessToken(token: string, secret: string): MemberAuthClaims {
  const decoded = jwt.verify(token, secret);
  const parsed = memberClaimsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("Invalid member token claims");
  }
  return parsed.data;
}

declare module "express-serve-static-core" {
  interface Request {
    memberAuth?: MemberAuthClaims;
  }
}

/** Mirrors `authClaims` in middleware/auth.ts, for the member session instead of staff. */
export function memberAuthClaims(req: Request): MemberAuthClaims {
  if (!req.memberAuth) throw unauthorizedError();
  return req.memberAuth;
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({
    success: false,
    error: { code: ErrorCode.UNAUTHORIZED, message },
    meta: { timestamp: new Date().toISOString(), requestId: randomUUID() }
  });
}

export function requireMemberAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    unauthorized(res, "Missing bearer token");
    return;
  }

  try {
    req.memberAuth = verifyMemberAccessToken(token, process.env.JWT_SECRET ?? "");
    next();
  } catch {
    unauthorized(res, "Invalid or expired token");
  }
}
