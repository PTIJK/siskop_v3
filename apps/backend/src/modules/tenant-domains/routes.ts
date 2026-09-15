import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantDomains } from "./service.js";

const handle = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
export function tenantDomainRoutes() {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  router.use(requireAuth, requirePermission("config", "read"));
  router.get("/", handle(async (req, res) => {
    res.json({ success: true, data: await tenantDomains.settings(authClaims(req)), meta: res.locals.meta });
  }));
  router.put("/", requirePermission("config", "update"), handle(async (req, res) => {
    const input = z.object({ slug: z.string().max(100), idToken: z.string().min(1).max(10000) }).strict().parse(req.body);
    res.json({ success: true, data: await tenantDomains.rename(authClaims(req), input), meta: res.locals.meta });
  }));
  return router;
}
