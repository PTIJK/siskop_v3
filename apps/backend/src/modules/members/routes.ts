import { Router, type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { ErrorCode } from "@siskop/types";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { AppError } from "../../lib/errors.js";
import { requireParam } from "../../lib/http.js";
import { createMemberSchema, listMembersQuerySchema, updateMemberSchema } from "./schema.js";
import {
  createMember,
  deactivateMember,
  getMemberById,
  listMembers,
  updateMember,
  uploadMemberKtp
} from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(process.env.STORAGE_PATH ?? "./uploads", "ktp", authClaims(req).tenantId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(ErrorCode.INVALID_FILE_TYPE, "File harus JPG, PNG, atau PDF"));
    }
  }
});

export function membersRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    requirePermission("members", "read"),
    handle(async (req, res) => {
      const query = listMembersQuerySchema.parse(req.query);
      const result = await listMembers(authClaims(req).tenantId, query);
      res.json({
        success: true,
        data: result.items,
        meta: { ...res.locals.meta, ...result.meta }
      });
    })
  );

  router.post(
    "/",
    requirePermission("members", "create"),
    handle(async (req, res) => {
      const data = createMemberSchema.parse(req.body);
      const member = await createMember(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: member, meta: res.locals.meta });
    })
  );

  router.get(
    "/:id",
    requirePermission("members", "read"),
    handle(async (req, res) => {
      const member = await getMemberById(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({ success: true, data: member, meta: res.locals.meta });
    })
  );

  router.put(
    "/:id",
    requirePermission("members", "update"),
    handle(async (req, res) => {
      const data = updateMemberSchema.parse(req.body);
      const member = await updateMember(authClaims(req).tenantId, requireParam(req, "id"), data);
      res.json({ success: true, data: member, meta: res.locals.meta });
    })
  );

  router.delete(
    "/:id",
    requirePermission("members", "delete"),
    handle(async (req, res) => {
      await deactivateMember(authClaims(req).tenantId, requireParam(req, "id"));
      res.json({
        success: true,
        data: { message: "Anggota berhasil dinonaktifkan" },
        meta: res.locals.meta
      });
    })
  );

  router.post(
    "/:id/upload-ktp",
    requirePermission("members", "update"),
    upload.single("ktp"),
    handle(async (req, res) => {
      if (!req.file) throw new AppError(ErrorCode.INVALID_FILE_TYPE, "File KTP wajib diunggah");
      // Built explicitly (forward slashes) rather than reusing req.file.path —
      // that's an OS filesystem path and would embed backslashes on Windows,
      // corrupting the URL.
      const tenantId = authClaims(req).tenantId;
      const url = `/uploads/ktp/${tenantId}/${req.file.filename}`;
      const member = await uploadMemberKtp(tenantId, requireParam(req, "id"), url);
      res.json({ success: true, data: member, meta: res.locals.meta });
    })
  );

  return router;
}
