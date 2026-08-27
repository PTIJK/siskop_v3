import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { unauthorized } from "../../lib/errors.js";
import { memberAuthClaims, requireMemberAuth } from "../../middleware/member-auth.js";
import { clearRefreshCookie, setRefreshCookie } from "../auth/refresh-cookie.js";
import {
  changeMemberPassword,
  getMemberProfile,
  loginMember,
  refreshMemberSession
} from "./service.js";

const MEMBER_REFRESH_COOKIE_NAME = "siskop_member_refresh_token";
const MEMBER_REFRESH_COOKIE_PATH = "/api/member-auth";

const loginBody = z.object({
  nik: z.string().min(1),
  password: z.string().min(1)
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

export function memberAuthRoutes(): Router {
  const router = Router();

  router.post(
    "/login",
    handle(async (req, res) => {
      const { nik, password } = loginBody.parse(req.body);
      const { refreshToken, ...session } = await loginMember(req.headers.host, nik, password);
      setRefreshCookie(res, refreshToken, { name: MEMBER_REFRESH_COOKIE_NAME, path: MEMBER_REFRESH_COOKIE_PATH });
      res.json({ success: true, data: session, meta: res.locals.meta });
    })
  );

  router.post(
    "/refresh",
    handle(async (req, res) => {
      const token = req.cookies?.[MEMBER_REFRESH_COOKIE_NAME];
      if (typeof token !== "string" || !token) throw unauthorized("Missing refresh token");

      const { refreshToken, ...rest } = await refreshMemberSession(token);
      setRefreshCookie(res, refreshToken, { name: MEMBER_REFRESH_COOKIE_NAME, path: MEMBER_REFRESH_COOKIE_PATH });
      res.json({ success: true, data: rest, meta: res.locals.meta });
    })
  );

  router.post(
    "/logout",
    handle(async (_req, res) => {
      clearRefreshCookie(res, { name: MEMBER_REFRESH_COOKIE_NAME, path: MEMBER_REFRESH_COOKIE_PATH });
      res.json({ success: true, data: { loggedOut: true }, meta: res.locals.meta });
    })
  );

  router.get(
    "/me",
    requireMemberAuth,
    handle(async (req, res) => {
      const auth = memberAuthClaims(req);
      const member = await getMemberProfile(auth.memberId, auth.tenantId);
      res.json({ success: true, data: member, meta: res.locals.meta });
    })
  );

  router.put(
    "/me/password",
    requireMemberAuth,
    handle(async (req, res) => {
      const auth = memberAuthClaims(req);
      const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
      await changeMemberPassword(auth.memberId, auth.tenantId, currentPassword, newPassword);
      res.json({ success: true, data: { changed: true }, meta: res.locals.meta });
    })
  );

  return router;
}
