import { useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useMemberAuth } from "@/stores/memberAuth";
import { memberApiPost } from "@/api/memberClient";

const ROUTE_LABELS: Record<string, string> = {
  "/anggota/dashboard": "Beranda",
  "/anggota/simpanan": "Simpanan",
  "/anggota/pinjaman": "Pinjaman",
  "/anggota/profil": "Profil Saya"
};

export function MemberTopbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const clear = useMemberAuth((s) => s.clear);

  const pageTitle =
    Object.entries(ROUTE_LABELS).find(
      ([path]) => location.pathname === path || location.pathname.startsWith(path + "/")
    )?.[1] ?? "SISKOP";

  function logout() {
    // Same reasoning as Topbar.tsx: the refresh token is an httpOnly cookie
    // this page can't see or delete — best-effort server call, navigate away
    // regardless of outcome.
    void memberApiPost("/member-auth/logout", {}).finally(() => {
      clear();
      navigate("/anggota/login", { replace: true });
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
