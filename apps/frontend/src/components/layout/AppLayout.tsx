import { useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { refreshAccessToken } from "@/api/client";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Toaster } from "../ui/toaster";

export function AppLayout() {
  const accessToken = useAuth((s) => s.accessToken);
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  const location = useLocation();

  // The access token lives only in memory (stores/auth.ts) — a hard reload
  // always starts with none. Try one silent refresh against the httpOnly
  // refresh cookie before deciding the session is gone, so reloading a page
  // doesn't bounce a still-valid session to /login.
  const [bootstrapping, setBootstrapping] = useState(!accessToken);

  useEffect(() => {
    if (accessToken) return;
    void refreshAccessToken()
      .catch(() => {})
      .finally(() => setBootstrapping(false));
  }, []);

  if (bootstrapping) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!accessToken) return <Navigate to="/login" replace />;

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
