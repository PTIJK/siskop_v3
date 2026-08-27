import ms from "ms";
import type { Response } from "express";

/**
 * The refresh token used to live in the JSON body, right next to the access
 * token — anything an XSS payload could read from `fetch()`'s response it
 * could also exfiltrate. `httpOnly` puts it out of JS's reach entirely;
 * `path` scopes it to the only routes that need it, so it isn't replayed on
 * every API call the way a cookie at `/` would be.
 */
export const REFRESH_COOKIE_NAME = "siskop_refresh_token";
const REFRESH_COOKIE_PATH = "/api/auth";

/**
 * `name`/`path` are overridable so the member-auth module (modules/member-auth)
 * can reuse this exact cookie security posture under its own name/path,
 * rather than duplicating it — the two sessions must never share one cookie,
 * since a member and a staff user could be logged in from the same browser.
 */
export function setRefreshCookie(
  res: Response,
  token: string,
  opts: { name?: string; path?: string } = {}
): void {
  res.cookie(opts.name ?? REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    // The dev server is plain HTTP; `secure` would silently drop the cookie there.
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: opts.path ?? REFRESH_COOKIE_PATH,
    maxAge: ms(process.env.JWT_REFRESH_EXPIRES_IN ?? "7d")
  });
}

export function clearRefreshCookie(res: Response, opts: { name?: string; path?: string } = {}): void {
  res.clearCookie(opts.name ?? REFRESH_COOKIE_NAME, { path: opts.path ?? REFRESH_COOKIE_PATH });
}
