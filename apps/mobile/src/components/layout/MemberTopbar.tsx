import { useLocation, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useMemberAuth } from "@/stores/memberAuth";
import { memberApiPost } from "@/api/memberClient";
import { BrandMark } from "./MemberAuthLayout";

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
      className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b bg-card px-4"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark className="h-7 w-7 shrink-0" />
        <h1 className="truncate text-[17px] font-extrabold tracking-tight text-foreground">{pageTitle}</h1>
      </div>
      <button
        onClick={logout}
        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Keluar"
      >
        <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    </header>
  );
}
