import { TenantPickerDialog } from "@/features/tenant-access/TenantPickerDialog";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useTenantAccessConfig, centralLocation } from "@/features/tenant-access/api";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { apiPost } from "@/api/client";
import { formatTanggalIndonesia } from "@/lib/format";
import { Avatar, AvatarFallback } from "../ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { NotificationBell } from "./NotificationBell";
import { LogOut, User, ChevronDown } from "lucide-react";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/members": "Anggota",
  "/members/new": "Tambah Anggota",
  "/savings": "Simpanan",
  "/savings/new": "Buka Rekening Simpanan",
  "/loans": "Pinjaman",
  "/loans/new": "Ajukan Pinjaman",
  "/loans/overdue": "Anggota Menunggak",
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

export function Topbar() {
  const [switchOpen, setSwitchOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const config = useTenantAccessConfig();
  const options = useQuery({ queryKey: ["switch-options", window.location.hostname], queryFn: () => apiFetch<{ total: number; currentTenantName?: string; switchUrl?: string }>("/tenant-access/switch-options"), enabled: config.data?.switching === true, staleTime: 60_000, retry: false });
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const location = useLocation();
  const [systemDate, setSystemDate] = useState(() => new Date());

  useEffect(() => {
    // The calendar day rarely changes mid-session, but a minute tick keeps it
    // correct for a tab left open across midnight without a full re-render.
    const id = setInterval(() => setSystemDate(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const pageTitle =
    Object.entries(ROUTE_LABELS).find(
      ([path]) => location.pathname === path || location.pathname.startsWith(path + "/")
    )?.[1] ?? "SISKOP";

  function logout() {
    setLogoutError("");
    void apiPost("/auth/logout", {}).then(() => {
      clear();
      if (config.data?.enabled) window.location.assign(centralLocation("/auth/logout"));
      else navigate("/login", { replace: true });
    }).catch(() => setLogoutError("Belum berhasil keluar. Coba lagi."));
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 lg:px-6">
      <div className="pl-10 lg:pl-0">
        <h1 className="text-base font-semibold text-foreground">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-3">
        {logoutError ? <p role="alert" className="text-sm text-destructive">{logoutError}</p> : null}
        {(options.data?.total ?? 0) > 1 ? <button className="rounded-md border px-3 py-2 text-sm" onClick={() => setSwitchOpen(true)}>{options.data?.currentTenantName} · Ganti Koperasi</button> : null}
        {switchOpen && user ? <TenantPickerDialog currentTenantId={user.tenantId} onCancel={() => setSwitchOpen(false)} beforeSwitch={() => window.location.pathname === "/dashboard" || window.confirm("Pindah koperasi? Perubahan yang belum disimpan akan ditinggalkan.")} /> : null}
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs">{user ? getInitials(user.name) : "U"}</AvatarFallback>
            </Avatar>
            <div className="hidden flex-col items-start sm:flex">
              <span className="text-xs font-medium">{user?.name ?? "Pengguna"}</span>
              {/* isPlatformAdmin users borrow a real tenant's role (roleName) purely to
                  satisfy User's roleId FK — showing it here would misleadingly imply
                  they administer that one tenant. */}
              <span className="text-xs text-muted-foreground">
                {user?.isPlatformAdmin ? "Platform Admin" : (user?.roleName ?? "")}
              </span>
              <span className="text-xs text-muted-foreground">{formatTanggalIndonesia(systemDate)}</span>
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="flex items-center gap-2 text-sm" onClick={() => navigate("/profile")}>
              <User className="h-4 w-4" />
              <div>
                <p className="font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout}
              className="flex items-center gap-2 text-sm text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4" />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
