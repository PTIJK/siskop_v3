import { useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/stores/auth";
import { apiPost } from "@/api/client";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/members": "Anggota",
  "/savings": "Simpanan",
  "/loans": "Pinjaman",
  "/reports": "Laporan",
  "/profile": "Profil Saya"
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// FR-MOB-PROFILE-01 (docs/06-PRD-SISKOP-Mobile-Version.md §7): the bottom
// tab bar only covers the 5 primary modules — Profile has no tab of its own,
// so the avatar here is its only entry point. Built deliberately (not an
// afterthought) to avoid repeating the Rekomendasi AI mistake: a screen that
// exists but that nothing links to (docs/06 §8.5).
export function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuth((s) => s.user);
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
      <div className="flex items-center gap-1.5">
        {user && (
          <button
            onClick={() => navigate("/profile")}
            aria-label="Profil Saya"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
          >
            {getInitials(user.name)}
          </button>
        )}
        <button onClick={logout} className="rounded-md p-2 text-muted-foreground hover:bg-accent" aria-label="Keluar">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
