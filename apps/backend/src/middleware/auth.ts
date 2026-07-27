import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { ErrorCode, type AuthClaims } from "@siskop/types";

const claimsSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  role: z.enum(["super_admin", "tenant_admin", "accountant", "member"])
});

export function signAccessToken(claims: AuthClaims, secret: string, expiresIn: string): string {
  return jwt.sign(claims, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyAccessToken(token: string, secret: string): AuthClaims {
  const decoded = jwt.verify(token, secret);
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Prefix with the field path: a *missing* claim yields zod's generic
    // "Required", which would not tell you which claim was absent.
    const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown";
    throw new Error(`Invalid token claims: ${detail}`);
  }
  return parsed.data;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthClaims;
  }
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({
    success: false,
    error: { code: ErrorCode.UNAUTHORIZED, message },
    meta: { timestamp: new Date().toISOString(), requestId: randomUUID() }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    unauthorized(res, "Missing bearer token");
    return;
  }

  try {
    req.auth = verifyAccessToken(token, process.env.JWT_SECRET ?? "");
    next();
  } catch {
    unauthorized(res, "Invalid or expired token");
  }
}
