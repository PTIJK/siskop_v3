import { NavLink } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { useIsMultiUnit } from "@/hooks/useIsMultiUnit";
import { useAuth } from "@/stores/auth";
import {
  LayoutDashboard,
  Users,
  PiggyBank,
  CreditCard,
  FileText,
  AlertTriangle,
  Building2,
  Landmark,
  Settings,
  X,
  Menu,
  Package as PackageIcon,
  ShieldCheck,
  Layers,
  PieChart
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PermissionAction, PermissionModule } from "@siskop/types";

// Config (Konfigurasi) is gated on any of config/roles/accounting:read below,
// since it's a single page covering all three.
const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" as const, action: "read" as const },
  { label: "Anggota", href: "/members", icon: Users, module: "members" as const, action: "read" as const },
  { label: "Simpanan", href: "/savings", icon: PiggyBank, module: "savings" as const, action: "read" as const },
  {
    label: "Pinjaman",
    href: "/loans",
    icon: CreditCard,
    module: "loans" as const,
    action: "read" as const,
    children: [
      { label: "Semua Pinjaman", href: "/loans" },
      { label: "Anggota Menunggak", href: "/loans/overdue", icon: AlertTriangle }
    ]
  },
  {
    label: "Laporan",
    href: "/reports",
    icon: FileText,
    module: "reports" as const,
    action: "read" as const,
    children: [
      { label: "Laporan Keuangan", href: "/reports" },
      { label: "Laporan Regulasi", href: "/reports/regulatory" }
    ]
  },
  // KSU (multi-unit) items — same reports:read permission gate the backend
  // routes require (requireAccountingEntitlement + requirePermission("reports",
  // "read"), see modules/ksu/routes.ts), plus requiresMultiUnit below so they
  // only show for a tenant with 2+ active CooperativeUnits. Not a replacement
  // of the permission filter, an addition to it — see the render loop.
  //
  // "Unit Usaha" is rendered separately below (not in this array) since it
  // also needs to show for a Toko-only Kasir (konsumen:read, no reports:read)
  // — it's the only nav path into a unit's Produk/Stok/POS/PPOB tabs.
  {
    label: "Laporan Konsolidasi",
    href: "/ksu/report",
    icon: PieChart,
    module: "reports" as const,
    action: "read" as const,
    requiresMultiUnit: true
  }
];

interface NavItemWithChildren {
  label: string;
  href: string;
  icon: React.ElementType;
  module: PermissionModule;
  action: PermissionAction;
  requiresMultiUnit?: boolean;
  children?: { label: string; href: string; icon?: React.ElementType }[];
}

function NavItemComponent({ item, onClose }: { item: NavItemWithChildren; onClose?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <svg
            className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="ml-4 mt-1 space-y-1 border-l border-slate-700 pl-3">
            {item.children.map((child) => (
              <NavLink
                key={child.href}
                to={child.href}
                end={child.href === item.href}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "border-l-2 border-primary bg-slate-700 text-white"
                      : "text-slate-400 hover:bg-slate-700 hover:text-white"
                  )
                }
              >
                {child.icon && <child.icon className="h-3 w-3" />}
                {child.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.href}
      end
      onClick={onClose}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
          isActive ? "border-l-2 border-primary bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-700 hover:text-white"
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </NavLink>
  );
}

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const { can } = usePermissions();
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  // Same useIsMultiUnit() hook App.tsx's RequireMultiUnit route gate uses —
  // one source of truth, so nav items and routes can never disagree. `data`
  // is undefined while /config/units is still pending or on error; treat
  // that as "not multi-unit" (fail closed) rather than flashing KSU items
  // before we've actually confirmed the tenant has 2+ active units.
  const isMultiUnit = useIsMultiUnit().data ?? false;

  return (
    <div className="flex h-full flex-col bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Building2 className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">SISKOP</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 hover:text-white lg:hidden">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {/* Platform admins run the SaaS platform, not any single tenant's
            cooperative — the tenant business modules below (Dashboard through
            Konfigurasi) come from the tenant role they're attached to purely to
            satisfy User's roleId FK (see modules/platform/service.ts), not from
            any intent for them to operate that tenant. Hide those modules
            entirely rather than exposing them because of an incidental role. */}
        {!isPlatformAdmin && (
          <>
            {/* Unit Usaha needs its own OR-gate (reports:read OR konsumen:read)
                instead of the single-module check the NAV_ITEMS loop below
                does — a Toko-only Kasir has konsumen:read but not reports:read,
                and this is the only nav path into a unit's POS/Produk/Stok/
                PPOB tabs (see UnitLayout.tsx). */}
            {(can("reports", "read") || can("konsumen", "read")) && isMultiUnit && (
              <NavItemComponent
                item={{ label: "Unit Usaha", href: "/ksu/units", icon: Layers, module: "reports", action: "read" }}
                onClose={onClose}
              />
            )}
            {NAV_ITEMS.map((item) => {
              if (!can(item.module, item.action)) return null;
              if (item.requiresMultiUnit && !isMultiUnit) return null;
              return <NavItemComponent key={item.href} item={item} onClose={onClose} />;
            })}
            {(can("config", "read") || can("roles", "read") || can("accounting", "read")) && (
              <NavItemComponent
                item={{ label: "Konfigurasi", href: "/config", icon: Settings, module: "config", action: "read" }}
                onClose={onClose}
              />
            )}
          </>
        )}

        {isPlatformAdmin && (
          <>
            <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Platform Admin
            </p>
            {[
              { href: "/platform/tenants", icon: Landmark, label: "Koperasi" },
              { href: "/platform/packages", icon: PackageIcon, label: "Paket Langganan" },
              { href: "/platform/admins", icon: ShieldCheck, label: "Admin Platform" }
            ].map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive ? "border-l-2 border-primary bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-700 hover:text-white"
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </>
        )}
      </nav>
    </div>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        className="fixed left-4 top-4 z-50 rounded-md bg-slate-900 p-2 text-white lg:hidden"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent onClose={() => setMobileOpen(false)} />
      </div>

      <div className="hidden w-64 shrink-0 lg:block">
        <SidebarContent />
      </div>
    </>
  );
}
