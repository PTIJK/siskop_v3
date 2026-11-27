import { createHash } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ErrorCode, type ExcelImportSummary } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { requireParam } from "../../lib/http.js";
import { handle, limiter } from "../../lib/public-guards.js";
import { getReadableUnitIds } from "../../lib/unit-access.js";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { readExcelDraft } from "./excel-draft.js";
import { excelApplyRoutes } from "./excel-apply-routes.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 }
}).single("file");
const pageSize = 15;
const selectSummary = { id: true, fileName: true, createdAt: true, counts: true, limited: true } as const;

function serializeSummary(row: Prisma.ExcelImportDraftGetPayload<{ select: typeof selectSummary }>): ExcelImportSummary {
  return { ...row, createdAt: row.createdAt.toISOString(), counts: row.counts as ExcelImportSummary["counts"] };
}

export function excelDraftRoutes() {
  const router = Router();
  router.use(requireAuth, requirePermission("config", "update"), (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    const { role, userId, tenantId } = authClaims(req);
    if (role !== "tenant_admin") throw forbidden("Impor Excel tersedia untuk admin koperasi.");
    // Drafts have no trusted unit assignments until they are reviewed.
    void getReadableUnitIds(userId, tenantId)
      .then((ids) => db.cooperativeUnit.count({ where: { tenantId, id: { notIn: ids } } }))
      .then((excluded) => {
        if (excluded > 0) throw forbidden("Impor Excel memerlukan akses ke semua unit koperasi.");
        next();
      })
      .catch(next);
  });

  router.get("/", handle(async (req, res) => {
    const page = z.coerce.number().int().min(1).max(100_000).default(1).parse(req.query.page);
    const rows = await db.excelImportDraft.findMany({
      where: { tenantId: authClaims(req).tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      select: selectSummary
    });
    res.json({ success: true, data: { drafts: rows.slice(0, pageSize).map(serializeSummary), hasMore: rows.length > pageSize }, meta: res.locals.meta });
  }));

  router.use("/:id/apply", excelApplyRoutes());

  router.get("/:id", handle(async (req, res) => {
    const row = await db.excelImportDraft.findFirst({
      where: { id: requireParam(req, "id"), tenantId: authClaims(req).tenantId },
      select: { ...selectSummary, records: true }
    });
    if (!row) throw notFound("Draf tidak ditemukan.");
    const { records, ...summary } = row;
    res.json({ success: true, data: { ...serializeSummary(summary), records }, meta: res.locals.meta });
  }));

  router.post("/", limiter(6), (req, res, next) => {
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        next(new AppError(ErrorCode.MIGRATION_FILE_INVALID, err.code === "LIMIT_FILE_SIZE"
          ? "Ukuran file maksimal 10 MB." : "Pilih satu file Excel (.xlsx)."));
      } else next(err);
    });
  }, handle(async (req, res) => {
    const file = req.file;
    if (!file || !/\.xlsx$/i.test(file.originalname)) {
      throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "Pilih satu file Excel (.xlsx).");
    }
    const tenantId = authClaims(req).tenantId;
    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    const where = { tenantId, fileHash };
    const parsed = await readExcelDraft(file.buffer);
    let row = await db.excelImportDraft.findFirst({ where, select: selectSummary });
    if (row) {
      row = await db.excelImportDraft.update({ where: { id: row.id, tenantId }, data: parsed, select: selectSummary });
    } else {
      try {
        row = await db.excelImportDraft.create({
          data: { ...where, fileName: file.originalname.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240), ...parsed },
          select: selectSummary
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
        row = await db.excelImportDraft.findFirstOrThrow({ where, select: selectSummary });
      }
    }
    res.json({ success: true, data: serializeSummary(row), meta: res.locals.meta });
  }));

  return router;
}
