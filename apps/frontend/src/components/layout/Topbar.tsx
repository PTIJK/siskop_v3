import { TenantPickerDialog } from "@/features/tenant-access/TenantPickerDialog";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useTenantAccessConfig, centralLocation } from "@/features/tenant-access/api";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { apiPost } from "@/api/client";
import { formatTanggalIndonesia } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { usePermissions } from "@/hooks/usePermissions";
import { useAccessibleUnits } from "@/hooks/useAccessibleUnits";
import { useUnitScope } from "@/stores/unit-scope";
import { ALL_UNITS } from "@/lib/unit";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { NotificationBell } from "./NotificationBell";
import { buildQuickActions } from "./nav";
import { LogOut, Menu, Moon, PanelLeft, ChevronDown, Search, Sun, User } from "lucide-react";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Only rendered for a koperasi with more than one unit: one unit means nothing to choose between. */
function UnitSelector() {
  const { data: units } = useAccessibleUnits();
  const unitId = useUnitScope((s) => s.unitId);
  const setUnitId = useUnitScope((s) => s.setUnitId);
  if (!units || units.length <= 1) return null;
  return (
    <Select value={unitId} onValueChange={setUnitId}>
      <SelectTrigger aria-label="Unit usaha" className="hidden h-[38px] w-[230px] rounded-full bg-card md:flex">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_UNITS}>Semua unit (konsolidasi)</SelectItem>
        {units.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
            {u.isActive ? "" : " (nonaktif)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function QuickActions() {
  const { can } = usePermissions();
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  const actions = buildQuickActions({ can, isPlatformAdmin });
  const [primary, ...rest] = actions;
  if (!primary) return null;
  const PrimaryIcon = primary.icon;
  return (
    <div className="flex items-center">
      <Button asChild variant="brand" className={rest.length > 0 ? "rounded-r-none max-sm:px-3" : "max-sm:px-3"}>
        <Link to={primary.href}>
          <PrimaryIcon aria-hidden="true" />
          <span className="max-sm:sr-only">{primary.label}</span>
        </Link>
      </Button>
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="brand" className="rounded-l-none border-l border-brand-foreground/25 px-2.5" aria-label="Aksi cepat lainnya">
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {rest.map((a) => {
              const Icon = a.icon;
              return (
                <DropdownMenuItem key={a.id} asChild>
                  <Link to={a.href} className="flex min-h-[40px] items-center gap-2 text-sm font-semibold">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    {a.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

interface TopbarProps {
  rail: boolean;
  onToggleRail: () => void;
  onOpenMenu: () => void;
  onOpenPalette: () => void;
}

export function Topbar({ rail, onToggleRail, onOpenMenu, onOpenPalette }: TopbarProps) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const config = useTenantAccessConfig();
  const options = useQuery({ queryKey: ["switch-options", window.location.hostname], queryFn: () => apiFetch<{ total: number; currentTenantName?: string; switchUrl?: string }>("/tenant-access/switch-options"), enabled: config.data?.switching === true, staleTime: 60_000, retry: false });
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [systemDate, setSystemDate] = useState(() => new Date());
  const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);

  useEffect(() => {
    // The calendar day rarely changes mid-session, but a minute tick keeps it
    // correct for a tab left open across midnight without a full re-render.
    const id = setInterval(() => setSystemDate(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  function logout() {
    setLogoutError("");
    void apiPost("/auth/logout", {}).then(() => {
      clear();
      if (config.data?.enabled) window.location.assign(centralLocation("/auth/logout"));
      else navigate("/login", { replace: true });
    }).catch(() => setLogoutError("Belum berhasil keluar. Coba lagi."));
  }

  const iconButton = "h-[38px] w-[38px] rounded-full border bg-card hover:bg-muted max-[900px]:h-11 max-[900px]:w-11";

  return (
    <header className="sticky top-0 z-topbar flex h-[60px] shrink-0 items-center gap-2.5 border-b bg-background/90 px-4 backdrop-blur-md min-[901px]:px-6">
      <Button variant="ghost" size="icon" onClick={onOpenMenu} aria-label="Buka menu" aria-controls="sidebar-mobile" className="h-11 w-11 min-[901px]:hidden">
        <Menu aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleRail}
        aria-label={rail ? "Lebarkan menu samping" : "Ciutkan menu samping"}
        aria-pressed={rail}
        className="hidden h-[38px] w-[38px] min-[901px]:inline-flex"
      >
        <PanelLeft aria-hidden="true" />
      </Button>

      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Cari atau buka perintah"
        aria-haspopup="dialog"
        className="flex h-[38px] w-full max-w-[420px] items-center gap-2.5 rounded-full border border-input bg-card px-3 text-left text-[13.5px] text-muted-foreground transition-colors hover:border-ring max-[900px]:h-11 max-sm:w-11 max-sm:justify-center max-sm:px-0"
      >
        <Search className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate max-sm:sr-only">Cari anggota, halaman, atau aksi</span>
        <kbd className="hidden rounded-md border border-b-2 border-input bg-muted px-1.5 py-0.5 text-[11px] font-semibold sm:inline">{isMac ? "⌘ K" : "Ctrl K"}</kbd>
      </button>

      <div className="flex-1" />

      {logoutError ? <p role="alert" className="text-sm text-destructive">{logoutError}</p> : null}
      <UnitSelector />
      {(options.data?.total ?? 0) > 1 ? <Button variant="outline" size="sm" className="hidden rounded-full lg:inline-flex" onClick={() => setSwitchOpen(true)}>{options.data?.currentTenantName} · Ganti Koperasi</Button> : null}
      {switchOpen && user ? <TenantPickerDialog currentTenantId={user.tenantId} onCancel={() => setSwitchOpen(false)} beforeSwitch={() => window.location.pathname === "/dashboard" || window.confirm("Pindah koperasi? Perubahan yang belum disimpan akan ditinggalkan.")} /> : null}
      <QuickActions />
      <NotificationBell />
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label={theme === "dark" ? "Ganti ke tema terang" : "Ganti ke tema gelap"}
        className={iconButton}
      >
        {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Menu pengguna"
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[900px]:min-h-11"
        >
          <Avatar className="h-[34px] w-[34px]">
            <AvatarFallback className="bg-accent text-xs font-extrabold text-accent-foreground">{user ? getInitials(user.name) : "U"}</AvatarFallback>
          </Avatar>
          <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-2 py-2">
            <p className="text-sm font-bold">{user?.name ?? "Pengguna"}</p>
            {/* isPlatformAdmin users borrow a real tenant's role (roleName) purely to
                satisfy User's roleId FK — showing it here would misleadingly imply
                they administer that one tenant. */}
            <p className="text-xs text-muted-foreground">{user?.isPlatformAdmin ? "Platform Admin" : (user?.roleName ?? "")}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">{formatTanggalIndonesia(systemDate)}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="flex min-h-[40px] items-center gap-2 text-sm" onClick={() => navigate("/profile")}>
            <User className="h-[18px] w-[18px]" aria-hidden="true" />
            Profil saya
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={logout}
            className="flex min-h-[40px] items-center gap-2 text-sm text-destructive focus:text-destructive"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
