import { useEffect, useState } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { refreshAccessToken } from "@/api/client";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";

// Same bootstrap pattern as apps/frontend/src/components/layout/AppLayout.tsx:
// the access token is memory-only, so a hard reload always starts with none —
// try one silent refresh against the httpOnly cookie before redirecting to
// /login, so reloading doesn't bounce a still-valid session.
export function AppLayout() {
  const accessToken = useAuth((s) => s.accessToken);
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
        <PageLoading />
      </div>
    );
  }

  if (!accessToken) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Topbar />
      <main className="flex-1 overflow-y-auto p-4 pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
