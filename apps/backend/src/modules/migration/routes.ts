import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { ErrorCode } from "@siskop/types";
import { AppError } from "../../lib/errors.js";
import { authClaims } from "../../middleware/auth.js";
import { executeMigration, previewMigration } from "./service.js";
import { buildTemplate } from "./template.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } }).single("file");
// Multipart text fields arrive as strings; an empty tenantId means "create a new koperasi".
const tenantIdField = z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).max(64).optional());
const previewBody = z.object({ tenantId: tenantIdField });
const executeBody = z
  .object({ fileHash: z.string().regex(/^[0-9a-f]{64}$/), tenantId: tenantIdField, adminPassword: z.string().optional() })
  .refine((b) => b.tenantId || (b.adminPassword ?? "").length >= 8, { message: "Kata sandi admin minimal 8 karakter", path: ["adminPassword"] });
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** multer reports its own error class, which the global handler would turn into a 500. */
function withFile(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "Ukuran file maksimal 10 MB" : "Unggahan tidak valid";
      next(new AppError(ErrorCode.MIGRATION_FILE_INVALID, message));
      return;
    }
    next(err);
  });
}

function fileOf(req: Request): Buffer {
  if (!req.file) throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "File .xlsx wajib diunggah");
  return req.file.buffer;
}

/** Mounted under /api/platform, which already applies requireAuth + requirePlatformAdmin. */
export function migrationRoutes(): Router {
  const router = Router();

  router.get(
    "/templates/:mode",
    handle(async (req, res) => {
      const mode = String(req.params.mode).toUpperCase();
      if (mode !== "SISTEM" && mode !== "LAPORAN") throw new AppError(ErrorCode.NOT_FOUND, "Template tidak ditemukan");
      res.setHeader("Content-Type", XLSX);
      res.setHeader("Content-Disposition", `attachment; filename="SISKOP-Template-Migrasi-${mode === "SISTEM" ? "Sistem" : "Laporan"}.xlsx"`);
      res.send(await buildTemplate(mode));
    })
  );

  router.post(
    "/preview",
    withFile,
    handle(async (req, res) => {
      const { tenantId } = previewBody.parse(req.body);
      const data = await previewMigration(fileOf(req), { tenantId });
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/execute",
    withFile,
    handle(async (req, res) => {
      const body = executeBody.parse(req.body);
      const data = await executeMigration(fileOf(req), {
        fileHash: body.fileHash,
        tenantId: body.tenantId,
        adminPassword: body.adminPassword,
        actor: {
          userId: authClaims(req).userId,
          requestId: String(res.locals.meta?.requestId ?? ""),
          ip: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null
        }
      });
      res.status(201).json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
