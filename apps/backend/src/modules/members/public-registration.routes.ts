import { Router, type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { ErrorCode } from "@siskop/types";
import { sniffFileType } from "../../lib/file-sniff.js";
import { AppError, notFound } from "../../lib/errors.js";
import { requireParam } from "../../lib/http.js";
import { submitRegistrationSchema } from "./public-registration.schema.js";
import { getPublicTenantBranding, resolveRegistrableTenant, submitPublicRegistration } from "./public-registration.service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** Same shape as onboarding/routes.ts's local limiter() — the only other
 * rate-limited router in this codebase. */
function limiter(limit: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: ErrorCode.RATE_LIMIT, message: "Terlalu banyak percobaan. Coba lagi nanti." },
        meta: res.locals.meta
      });
    }
  });
}

function submissionRateLimiter() {
  const configured = Number(process.env.SELF_REGISTRATION_RATE_LIMIT_PER_HOUR);
  const perHour = Number.isFinite(configured) && configured > 0 ? configured : 5;
  return limiter(perHour, 60 * 60_000);
}

// Same allowlist and 2MB cap as the internal KTP upload (members/routes.ts),
// but memoryStorage: the tenant directory isn't known until the slug
// resolves inside the handler below, and fileFilter's declared-MIME check is
// only a first pass here — the handler re-validates by sniffing the actual
// bytes (lib/file-sniff.ts) before anything is written to disk, since this
// request has no authenticated uploader behind it.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype)) cb(null, true);
    else cb(new AppError(ErrorCode.INVALID_FILE_TYPE, "File harus JPG, PNG, atau PDF"));
  }
});

/**
 * The public QR self-registration surface — no requireAuth anywhere in this
 * router. Mounted directly in app.ts at /api/public/register, deliberately
 * not nested under /api/members (which is requireAuth-gated end to end).
 */
export function publicMemberRegistrationRoutes(): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get(
    "/:tenantSlug",
    limiter(60, 60_000),
    handle(async (req, res) => {
      const data = await getPublicTenantBranding(requireParam(req, "tenantSlug"));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/:tenantSlug",
    submissionRateLimiter(),
    upload.single("ktp"),
    handle(async (req, res) => {
      const tenantSlug = requireParam(req, "tenantSlug");

      // Resolved (and the disabled/nonexistent case rejected, both as the
      // same generic 404) before field validation or writes, with no signal
      // about which case it was.
      const tenant = await resolveRegistrableTenant(tenantSlug);
      if (!tenant) throw notFound("Pendaftaran tidak ditemukan");

      const data = submitRegistrationSchema.parse(req.body);

      let ktp: { buffer: Buffer; type: NonNullable<ReturnType<typeof sniffFileType>> } | undefined;
      if (req.file) {
        const sniffed = sniffFileType(req.file.buffer);
        if (!sniffed) throw new AppError(ErrorCode.INVALID_FILE_TYPE, "File KTP tidak valid");
        ktp = { buffer: req.file.buffer, type: sniffed };
      }

      const result = await submitPublicRegistration(tenant.id, data, ktp);
      res.status(201).json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  return router;
}
