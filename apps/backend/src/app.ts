import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ErrorCode } from "@siskop/types";

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

  // Served on both paths deliberately: "/health" is the root-level liveness
  // probe (docker/compose healthchecks), while "/api/health" is what the
  // frontend's typed client reaches, since apiFetch prefixes every call with
  // /api and the Vite proxy forwards that prefix unrewritten.
  app.get(["/health", "/api/health"], (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: { status: "ok", timestamp: new Date().toISOString() },
      meta: meta()
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: ErrorCode.NOT_FOUND, message: "Endpoint not found" },
      meta: meta()
    });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({
      success: false,
      error: { code: ErrorCode.INTERNAL_ERROR, message: "Internal server error" },
      meta: meta()
    });
  });

  return app;
}
