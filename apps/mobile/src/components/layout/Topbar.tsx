import { useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/stores/auth";
import { apiPost } from "@/api/client";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/members": "Anggota",
  "/savings": "Simpanan",
  "/loans": "Pinjaman",
  "/reports": "Laporan"
};

export function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const clear = useAuth((s) => s.clear);

  const pageTitle =
    Object.entries(ROUTE_LABELS).find(
      ([path]) => location.pathname === path || location.pathname.startsWith(path + "/")
    )?.[1] ?? "SISKOP";

  function logout() {
    // Same reasoning as apps/frontend/src/components/layout/Topbar.tsx: the
    // refresh token is an httpOnly cookie this page can't see or delete —
    // best-effort server call, navigate away regardless of outcome.
    void apiPost("/auth/logout", {}).finally(() => {
      clear();
      navigate("/login", { replace: true });
    });
  }

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <h1 className="text-base font-semibold text-foreground">{pageTitle}</h1>
      <button onClick={logout} className="rounded-md p-2 text-muted-foreground hover:bg-accent" aria-label="Keluar">
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}
