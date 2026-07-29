import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { Avatar, AvatarFallback } from "../ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
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
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const location = useLocation();

  const pageTitle =
    Object.entries(ROUTE_LABELS).find(
      ([path]) => location.pathname === path || location.pathname.startsWith(path + "/")
    )?.[1] ?? "SISKOP";

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 lg:px-6">
      <div className="pl-10 lg:pl-0">
        <h1 className="text-base font-semibold text-foreground">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs">{user ? getInitials(user.name) : "U"}</AvatarFallback>
            </Avatar>
            <div className="hidden flex-col items-start sm:flex">
              <span className="text-xs font-medium">{user?.name ?? "Pengguna"}</span>
              <span className="text-xs text-muted-foreground">{user?.roleName ?? ""}</span>
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
