import type { CookieOptions, RequestHandler } from "express";

const sessions = [
  { name: "siskop_onboarding", path: "/api/onboarding" },
  { name: "siskop_refresh_token", path: "/api/auth" },
  { name: "siskop_member_refresh_token", path: "/api/member-auth" }
];

/** Firebase forwards only __session. Keep existing auth modules and cookie paths intact. */
export function firebaseHosting(): RequestHandler {
  return (req, res, next) => {
    const scope = sessions.find(({ path }) => req.path === path || req.path.startsWith(`${path}/`));
    const incoming = (req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("__session="));
    // Reject duplicate cookies rather than let parser ordering choose a credential.
    req.headers.cookie =
      scope && incoming.length === 1 ? `${scope.name}=${incoming[0]!.slice("__session=".length)}` : "";
    const cookie = res.cookie.bind(res);
    res.cookie = (name: string, value: unknown, options: CookieOptions = {}) =>
      cookie(sessions.some((session) => session.name === name) ? "__session" : name, value, options);
    res.set("Cache-Control", "private, no-store");
    next();
  };
}
