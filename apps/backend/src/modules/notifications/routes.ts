import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requireParam } from "../../lib/http.js";
import { listNotificationsForUser, markNotificationRead } from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * Tenant + permission-scoped in-app notifications (distinct from the
 * platform-admin-only Notification/NotificationRead — see schema.prisma).
 * No requirePermission beyond requireAuth: visibility is already filtered
 * per-notification inside listNotificationsForUser, and marking read only
 * ever touches the caller's own read-state.
 */
export function notificationsRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    handle(async (req, res) => {
      const result = await listNotificationsForUser(authClaims(req));
      res.json({ success: true, data: result.items, meta: { ...res.locals.meta, unreadCount: result.unreadCount } });
    })
  );

  router.post(
    "/:id/read",
    handle(async (req, res) => {
      const auth = authClaims(req);
      await markNotificationRead(auth.tenantId, auth.userId, requireParam(req, "id"));
      res.json({ success: true, data: { message: "Notifikasi ditandai sudah dibaca" }, meta: res.locals.meta });
    })
  );

  return router;
}
