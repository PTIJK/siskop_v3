import type { Request, Response, NextFunction } from "express";
import type { WorkspaceContext } from "@siskop/types";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { ErrorCode } from "@siskop/types";
import { tenantBaseDomain, tenantDomainsEnabled } from "./config.js";
import { classifyHost } from "./policy.js";
import { tenantDomains } from "./service.js";
import { gatewayHost } from "./gateway.js";
import { centralUrl, selectionEnabled } from "../tenant-access/config.js";

declare module "express-serve-static-core" {
  interface Request { workspace?: WorkspaceContext; workspaceHost?: string }
}

export function assertWorkspaceTenant(req: Request, tenantId: string, platformAdmin = false): void {
  if (req.workspace && req.workspace.tenantId !== tenantId) throw forbidden("Akun ini tidak memiliki akses ke workspace ini.");
  if (req.workspace && platformAdmin) throw forbidden("Gunakan situs pusat untuk akun admin platform.");
}
export function trustedRequestOrigin(req: Request): string | null {
  if (!req.workspaceHost) return null;
  return `${process.env.NODE_ENV === "production" ? "https" : "http"}://${req.workspaceHost}`;
}
export function workspaceRequest(req: Request, res: Response, next: NextFunction): void {
  void resolveRequest(req, res).then(() => next(), next);
}
async function resolveRequest(req: Request, res: Response) {
  const signedHost = gatewayHost(req);
  // The gateway may be staged while routing remains disabled; never silently
  // interpret its traffic as central-site traffic before activation.
  if (signedHost && !tenantDomainsEnabled()) throw forbidden("Workspace routing is not enabled");
  if (!tenantDomainsEnabled()) return;
  const base = tenantBaseDomain()!;
  const host = signedHost ?? req.headers.host ?? "";
  const parsed = classifyHost(host, base);
  if (!signedHost) {
    if (parsed.kind === "tenant" || parsed.kind === "reserved" || host.toLowerCase().includes(base)) {
      throw forbidden("Workspace gateway required");
    }
    // Central Hosting and direct API integrations retain their existing auth.
    // A tenant browser must use its authenticated, same-origin gateway.
    const origin = req.get("origin");
    if (origin) {
      let hostname = "";
      try { hostname = new URL(origin).hostname; } catch { throw forbidden("Invalid origin"); }
      if (hostname === base || hostname.endsWith(`.${base}`)) throw forbidden("Workspace gateway required");
    }
    return;
  }
  if (parsed.kind !== "tenant") throw notFound("Workspace tidak ditemukan.");
  req.workspaceHost = host;
  const origin = req.get("origin");
  // Only the direct staff form receiver may accept a central-site POST.
  // Host resolution still requires the signed gateway and the route checks
  // the ticket, canonical tenant, exact Origin, and top-level navigation.
  const centralHandoff = req.method === 'POST' && req.path === '/api/tenant-access/accept' &&
    selectionEnabled() && origin === new URL(centralUrl()).origin;
  if (origin && origin !== trustedRequestOrigin(req) && !centralHandoff) throw forbidden("Origin does not match workspace");
  res.set("Cache-Control", "private, no-store");
  req.workspace = await tenantDomains.resolve(parsed.slug);
  if (req.workspace.isAlias && req.path !== "/api/workspace") {
    throw new AppError(ErrorCode.WORKSPACE_MOVED, "Alamat workspace telah berubah. Masuk melalui alamat baru.", { loginUrl: req.workspace.canonicalLoginUrl });
  }
  if (req.path.startsWith("/api/platform") || req.path.startsWith("/api/scheduler") ||
      req.path.startsWith("/api/onboarding") && !["/api/onboarding/login"].includes(req.path)) {
    throw forbidden("Gunakan situs pusat untuk pendaftaran, pembayaran, dan administrasi platform.");
  }
  if (req.path.startsWith("/uploads/") && !req.path.startsWith(`/uploads/ktp/${req.workspace.tenantId}/`)) {
    throw notFound();
  }
}
