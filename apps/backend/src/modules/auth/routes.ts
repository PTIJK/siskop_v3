import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { unauthorized } from "../../lib/errors.js";
import { slugFromHost } from "./tenant-host.js";
import { login, refreshSession, registerTenant } from "./service.js";

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const refreshBody = z.object({ refreshToken: z.string().min(1) });

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function authRoutes(): Router {
  const router = Router();

  router.post(
    "/register",
    handle(async (req, res) => {
      const session = await registerTenant(req.body);
      res.status(201).json({ success: true, data: session, meta: res.locals.meta });
    })
  );

  router.post(
    "/login",
    handle(async (req, res) => {
      const { email, password } = loginBody.parse(req.body);
      // The tenant comes from the Host header, never the body — a caller must
      // not be able to name the tenant it wants to authenticate against.
      const session = await login(slugFromHost(req.headers.host), email, password);
      res.json({ success: true, data: session, meta: res.locals.meta });
    })
  );

  router.post(
    "/refresh",
    handle(async (req, res) => {
      const { refreshToken } = refreshBody.parse(req.body);
      res.json({ success: true, data: await refreshSession(refreshToken), meta: res.locals.meta });
    })
  );

  router.get(
    "/me",
    requireAuth,
    handle(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw unauthorized();

      // Scoped by tenantId as well as id: rule 1 holds even when the id alone
      // would be sufficient, so the pattern stays uniform across every module.
      const user = await db.user.findFirst({
        where: { id: auth.userId, tenantId: auth.tenantId },
        select: {
          id: true,
          tenantId: true,
          email: true,
          phone: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        }
      });
      if (!user) throw unauthorized();

      res.json({ success: true, data: user, meta: res.locals.meta });
    })
  );

  return router;
}
