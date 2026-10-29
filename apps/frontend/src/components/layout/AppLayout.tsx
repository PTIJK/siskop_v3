import { useTenantAccessConfig } from "@/features/tenant-access/api";
import { tenantSlug } from "@/features/workspace-domain/host";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { AccessBanner } from "./AccessBanner";
import { CommandPalette } from "./CommandPalette";
import { BrandStyle } from "./BrandStyle";
import { Toaster } from "../ui/toaster";
import { HandoffSessionGate } from "@/features/tenant-access/HandoffSessionGate";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PageLoading } from "../shared/LoadingSpinner";

const RAIL_KEY = "siskop.sidebar.rail";

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const accessConfig = useTenantAccessConfig();
  const user = useAuth((s) => s.user);
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  const location = useLocation();
  const [rail, setRail] = useState(readRail);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closeMobile = useCallback((open: boolean) => setMobileOpen(open), []);

  useEffect(() => {
    // Ctrl/Cmd+K from anywhere in the shell; the palette itself closes on Esc.
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleRail = () =>
    setRail((value) => {
      const next = !value;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        // Not persisted when storage is blocked; the toggle still works for this visit.
      }
      return next;
    });

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
    <div className="flex min-h-screen bg-background">
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary-foreground"
      >
        Lewati ke konten
      </a>
      <Sidebar rail={rail} mobileOpen={mobileOpen} onMobileOpenChange={closeMobile} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          rail={rail}
          onToggleRail={toggleRail}
          onOpenMenu={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <AccessBanner />
        <main id="konten" tabIndex={-1} className="w-full max-w-[1500px] flex-1 px-4 pb-10 pt-[22px] outline-none min-[901px]:px-6">
          {/* Keep the navigation shell visible when a lazy route is loading. */}
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BrandStyle />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Toaster />
    </div>
  );
}
