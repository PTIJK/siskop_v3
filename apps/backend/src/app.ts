import { requestMetrics } from "./modules/platform-dashboard/request-metrics.js";
import { tenantAccessRoutes } from "./modules/tenant-access/routes.js";
import { onboardingRoutes } from "./modules/onboarding/routes.js";
import { tenantEnforcement } from "./middleware/enforcement.js";
import { paymentWebhookRoutes } from "./modules/payments/webhook-routes.js";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { ErrorCode } from "@siskop/types";
import { AppError } from "./lib/errors.js";
import { authRoutes } from "./modules/auth/routes.js";
import { memberAuthRoutes } from "./modules/member-auth/routes.js";
import { memberAccessRoutes } from "./modules/member-access/routes.js";
import { memberPortalRoutes } from "./modules/member-portal/routes.js";
import { membersRoutes } from "./modules/members/routes.js";
import { publicMemberRegistrationRoutes } from "./modules/members/public-registration.routes.js";
import { savingsRoutes } from "./modules/savings/routes.js";
import { loansRoutes } from "./modules/loans/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { configRoutes } from "./modules/config/routes.js";
import { publicPricingRoutes } from "./modules/pricing/routes.js";
import { usersRoutes } from "./modules/users/routes.js";
import { reportsRoutes } from "./modules/reports/routes.js";
import { platformRoutes } from "./modules/platform/routes.js";
import { ksuRoutes } from "./modules/ksu/routes.js";
import { konsumenRoutes } from "./modules/konsumen/product.routes.js";
import { schedulerRoutes } from "./modules/scheduler/routes.js";
import { notificationsRoutes } from "./modules/notifications/routes.js";
import { auditLogRoutes } from "./modules/audit-log/routes.js";
import { expensesRoutes } from "./modules/expenses/routes.js";
import { marketRoutes } from "./modules/market/routes.js";
import { collectionsRoutes } from "./modules/collections/routes.js";
import { journalRoutes } from "./modules/journal/routes.js";
import { workspaceRequest } from "./modules/tenant-domains/middleware.js";
import { tenantDomainRoutes } from "./modules/tenant-domains/routes.js";
import { gcsUploads } from "./hosting/gcs-uploads.js";

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
  // Authentication refresh and onboarding recovery use httpOnly cookies.
  app.use(cookieParser());
  app.use(workspaceRequest);

  // Serves KTP uploads (members/routes.ts) at the same URL path they're stored
  // under (/uploads/ktp/{tenantId}/{file}). Helmet's default CORP header would
  // otherwise block cross-origin <img> loads from the Vite dev server.
  app.use(
    "/uploads",
    process.env.STORAGE_DRIVER === "gcs" ? gcsUploads() : express.static(path.resolve(process.env.STORAGE_PATH ?? "./uploads"), {
      setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
    })
  );

  // One requestId per request, shared by the success and error paths so a
  // client-reported id matches exactly one line in the logs.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.meta = meta();
    next();
  });

  // Latency and 5xx telemetry for the platform dashboard; buffered in memory, flushed by main.ts.
  app.use(requestMetrics());

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

  app.use("/api/onboarding", onboardingRoutes());
  app.use("/api/webhooks/payments", paymentWebhookRoutes());
  app.get("/api/workspace", (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.json({ success: true, data: req.workspace ?? null, meta: res.locals.meta });
  });
  // Pricing V2: payment standing and package features for every tenant route below (off by default).
  app.use("/api", tenantEnforcement());
  app.use("/api/tenant-domain", tenantDomainRoutes());
  app.use("/api/tenant-access", tenantAccessRoutes());
  app.use("/api/auth", authRoutes());
  app.use("/api/member-auth", memberAuthRoutes());
  app.use("/api/member-access", memberAccessRoutes());
  app.use("/api/member", memberPortalRoutes());
  app.use("/api/members", membersRoutes());
  app.use("/api/public/register", publicMemberRegistrationRoutes());
  app.use("/api/public/pricing", publicPricingRoutes());
  app.use("/api/savings", savingsRoutes());
  app.use("/api/loans", loansRoutes());
  app.use("/api/dashboard", dashboardRoutes());
  app.use("/api/config", configRoutes());
  app.use("/api/users", usersRoutes());
  app.use("/api/reports", reportsRoutes());
  app.use("/api/platform", platformRoutes());
  app.use("/api/ksu", ksuRoutes());
  app.use("/api/konsumen", konsumenRoutes());
  app.use("/api/scheduler", schedulerRoutes());
  app.use("/api/notifications", notificationsRoutes());
  app.use("/api/audit-log", auditLogRoutes());
  app.use("/api/expenses", expensesRoutes());
  app.use("/api/market", marketRoutes());
  app.use("/api/collections", collectionsRoutes());
  app.use("/api/journal", journalRoutes());

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
