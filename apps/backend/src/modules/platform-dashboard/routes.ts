import { Router, type NextFunction, type Request, type Response } from "express";
import { dashboardQuerySchema } from "./schema.js";
import { getPlatformDashboard } from "./service.js";

/** Mounted under platformRoutes(), which already applies requireAuth + requirePlatformAdmin. */
export function platformDashboardRoutes(): Router {
  const router = Router();
  router.get("/", (req: Request, res: Response, next: NextFunction) => {
    const { range } = dashboardQuerySchema.parse(req.query);
    getPlatformDashboard(range)
      .then((data) => res.json({ success: true, data, meta: res.locals.meta }))
      .catch(next);
  });
  return router;
}
