import { useTenantAccessConfig } from "@/features/tenant-access/api";
import { tenantSlug } from "@/features/workspace-domain/host";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Toaster } from "../ui/toaster";
import { HandoffSessionGate } from "@/features/tenant-access/HandoffSessionGate";

export function AppLayout() {
  const accessConfig = useTenantAccessConfig();
  const user = useAuth((s) => s.user);
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  const location = useLocation();

  if (tenantSlug() !== null && new URLSearchParams(location.search).get('handoff') === '1')
    return <HandoffSessionGate />;

  // The access token lives only in memory (stores/auth.ts), so it's always
  // null right after a hard reload — but `user` is cached in localStorage and
  // available synchronously, so the shell renders from it immediately instead
  // of blanking behind a spinner while waiting on a token. Nothing here needs
  // to kick off the refresh itself: Sidebar's useIsMultiUnit() (and whichever
  // page query fires first) will 401 once with no token and transparently
  // refresh-and-retry via withAuthRetry (api/client.ts) — same shared,
  // deduped refresh call as a token expiring mid-session. If that refresh
  // genuinely fails (dead session), those queries clear() the auth store,
  // `user` becomes null, and this redirects to /login on the next render.
  if (tenantSlug() === null && !isPlatformAdmin) {
    if (accessConfig.isPending) return <p role="status" className="p-8">Memeriksa alamat koperasi…</p>;
    if (accessConfig.isError) return <p role="alert" className="p-8">Belum dapat memeriksa akses. <button onClick={() => void accessConfig.refetch()}>Coba lagi</button></p>;
    if (accessConfig.data?.enabled) return <Navigate to="/login?select=1" replace />;
  }
  if (!user) return <Navigate to="/login" replace />;

  // Platform admins are attached to a real tenant's role purely to satisfy a
  // DB FK (see modules/platform/service.ts) — that must not let them browse
  // into that tenant's business routes by URL, even though their JWT carries
  // real permissions for it. Confine them to /platform/* (+ their own /profile).
  const allowedForPlatformAdmin = location.pathname.startsWith("/platform") || location.pathname === "/profile";
  if (isPlatformAdmin && !allowedForPlatformAdmin) {
    return <Navigate to="/platform/tenants" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
