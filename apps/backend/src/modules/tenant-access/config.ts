import { tenantDomainsEnabled, tenantLoginUrl } from "../tenant-domains/config.js";
export function selectionEnabled() { return tenantDomainsEnabled() && process.env.TENANT_LOGIN_SELECTION_ENABLED === "true"; }
export function switchingEnabled() { return selectionEnabled() && process.env.TENANT_SWITCHING_ENABLED === "true"; }
export function centralUrl(path = "/login") {
  const base = new URL(process.env.PUBLIC_APP_URL ?? "http://localhost:3000");
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") throw new Error("PUBLIC_APP_URL must use HTTPS");
  return new URL(path, base.origin).toString();
}
export function tenantOrigin(slug: string) { return new URL(tenantLoginUrl(slug)).origin; }
