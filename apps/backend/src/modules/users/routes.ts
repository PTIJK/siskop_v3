import { inviteMembership } from "../tenant-access/invitations.js";
import { selectionEnabled } from "../tenant-access/config.js";
import { forbidden } from "../../lib/errors.js";
import { Router, type Request, type Response, type NextFunction } from "express";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireParam } from "../../lib/http.js";
import { createUserSchema, updateUserSchema } from "./schema.js";
import { createUser, createInvitedUser, listUsers, updateUser } from "./service.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function usersRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/invitations", requirePermission("users", "create"), handle(async (req, res) => {
    if (!selectionEnabled()) throw forbidden("Undangan belum diaktifkan.");
    const tenantId = authClaims(req).tenantId;
    const user = await createInvitedUser(tenantId, createUserSchema.omit({ password: true }).parse(req.body));
    res.status(201).json({ success: true, data: await inviteMembership(tenantId, user.id), meta: res.locals.meta });
  }));
  router.post("/:id/invitation", requirePermission("users", "update"), handle(async (req, res) => {
    if (!selectionEnabled()) throw forbidden("Undangan belum diaktifkan.");
    res.json({ success: true, data: await inviteMembership(authClaims(req).tenantId, requireParam(req, "id")), meta: res.locals.meta });
  }));

  router.get(
    "/",
    requirePermission("users", "read"),
    handle(async (req, res) => {
      const data = await listUsers(authClaims(req).tenantId);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.post(
    "/",
    requirePermission("users", "create"),
    handle(async (req, res) => {
      const data = createUserSchema.parse(req.body);
      const user = await createUser(authClaims(req).tenantId, data);
      res.status(201).json({ success: true, data: user, meta: res.locals.meta });
    })
  );

  router.put(
    "/:id",
    requirePermission("users", "update"),
    handle(async (req, res) => {
      const data = updateUserSchema.parse(req.body);
      const auth = authClaims(req);
      const user = await updateUser(auth.tenantId, requireParam(req, "id"), data, auth.userId);
      res.json({ success: true, data: user, meta: res.locals.meta });
    })
  );

  return router;
}
