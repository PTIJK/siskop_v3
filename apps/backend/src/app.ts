import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { ErrorCode } from "@siskop/types";
import { AppError } from "./lib/errors.js";
import { authRoutes } from "./modules/auth/routes.js";

function meta() {
  return { timestamp: new Date().toISOString(), requestId: randomUUID() };
}

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: (process.env.CORS_ORIGIN ?? "").split(",").filter(Boolean),
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

  // One requestId per request, shared by the success and error paths so a
  // client-reported id matches exactly one line in the logs.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.meta = meta();
    next();
  });

  // Served on both paths deliberately: "/health" is the root-level liveness
  // probe (docker/compose healthchecks), while "/api/health" is what the
  // frontend's typed client reaches, since apiFetch prefixes every call with
  // /api and the Vite proxy forwards that prefix unrewritten.
  app.get(["/health", "/api/health"], (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: { status: "ok", timestamp: new Date().toISOString() },
      meta: res.locals.meta
    });
  });

  app.use("/api/auth", authRoutes());

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: ErrorCode.NOT_FOUND, message: "Endpoint not found" },
      meta: res.locals.meta ?? meta()
    });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const envelopeMeta = res.locals.meta ?? meta();

    // A Zod failure is the caller's malformed input, not a server fault; the
    // field paths are safe to return because the caller supplied them.
    if (err instanceof ZodError) {
      res.status(422).json({
        success: false,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: err.issues[0]?.message ?? "Invalid request",
          details: {
            issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
          }
        },
        meta: envelopeMeta
      });
      return;
    }

    if (err instanceof AppError) {
      res.status(err.status).json({
        success: false,
        error: { code: err.code, message: err.clientMessage, details: err.details },
        meta: envelopeMeta
      });
      return;
    }

    // Anything unrecognised is assumed to carry internals: log it, return nothing.
    console.error(err);
    res.status(500).json({
      success: false,
      error: { code: ErrorCode.INTERNAL_ERROR, message: "Internal server error" },
      meta: envelopeMeta
    });
  });

  return app;
}
