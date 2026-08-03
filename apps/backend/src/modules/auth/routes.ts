import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { unauthorized } from "../../lib/errors.js";
import { slugFromHost } from "./tenant-host.js";
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "./refresh-cookie.js";
import { changePassword, getMe, login, refreshSession, registerTenant, updateProfile } from "./service.js";

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const updateProfileBody = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  email: z.string().email("Email tidak valid")
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1, "Password saat ini wajib diisi"),
  newPassword: z.string().min(8, "Password baru minimal 8 karakter")
});

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
      const { refreshToken, ...session } = await registerTenant(req.body);
      setRefreshCookie(res, refreshToken);
      res.status(201).json({ success: true, data: session, meta: res.locals.meta });
    })
  );

  router.post(
    "/login",
    handle(async (req, res) => {
      const { email, password } = loginBody.parse(req.body);
      // The tenant comes from the Host header, never the body — a caller must
      // not be able to name the tenant it wants to authenticate against.
      const { refreshToken, ...session } = await login(slugFromHost(req.headers.host), email, password);
      setRefreshCookie(res, refreshToken);
      res.json({ success: true, data: session, meta: res.locals.meta });
    })
  );

  router.post(
    "/refresh",
    handle(async (req, res) => {
      // httpOnly, so this is the only place the token can come from — a body
      // field here would just reopen the XSS exposure this cookie closes.
      const token = req.cookies?.[REFRESH_COOKIE_NAME];
      if (typeof token !== "string" || !token) throw unauthorized("Missing refresh token");

      const { refreshToken, ...rest } = await refreshSession(token);
      setRefreshCookie(res, refreshToken);
      res.json({ success: true, data: rest, meta: res.locals.meta });
    })
  );

  router.post(
    "/logout",
    handle(async (_req, res) => {
      clearRefreshCookie(res);
      res.json({ success: true, data: { loggedOut: true }, meta: res.locals.meta });
    })
  );

  router.get(
    "/me",
    requireAuth,
    handle(async (req, res) => {
      const auth = authClaims(req);

      // Scoped by tenantId as well as id: rule 1 holds even when the id alone
      // would be sufficient, so the pattern stays uniform across every module.
      const user = await getMe(auth.userId, auth.tenantId);
      if (!user) throw unauthorized();

      res.json({ success: true, data: user, meta: res.locals.meta });
    })
  );

  router.put(
    "/me",
    requireAuth,
    handle(async (req, res) => {
      const auth = authClaims(req);
      const data = updateProfileBody.parse(req.body);
      const user = await updateProfile(auth.userId, auth.tenantId, data);
      res.json({ success: true, data: user, meta: res.locals.meta });
    })
  );

  router.put(
    "/me/password",
    requireAuth,
    handle(async (req, res) => {
      const auth = authClaims(req);
      const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
      await changePassword(auth.userId, auth.tenantId, currentPassword, newPassword);
      res.json({ success: true, data: { changed: true }, meta: res.locals.meta });
    })
  );

  return router;
}
