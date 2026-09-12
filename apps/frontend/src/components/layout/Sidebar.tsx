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
  Store,
  Settings,
  X,
  Menu,
  Package as PackageIcon,
  ShieldCheck,
  Layers,
  PieChart,
  Receipt
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// Config (Konfigurasi) is gated on any of config/roles/accounting:read below,
// since it's a single page covering all three. Simpanan/Pinjaman used to live
// here as top-level items — they now live inside the dynamically-built "Unit
// Usaha" tree below (still individually gated on savings:read/loans:read),
// since the requested menu nests them under Unit Usaha > KSP.
//
// Split in two (rather than one flat array) so Unit Usaha can render between
// them: Dashboard/Anggota, then Unit Usaha, then Laporan/Laporan Konsolidasi,
// then Konfigurasi — see the render order in SidebarContent below.
const NAV_ITEMS_TOP = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "dashboard" as const, action: "read" as const },
  { label: "Anggota", href: "/members", icon: Users, module: "members" as const, action: "read" as const },
  // Tenant-wide (not unit-scoped, even though the credit originates at
  // Konsumen/Toko's POS) — top-level rather than nested under Unit Usaha >
  // Konsumen, which would misleadingly imply unit-scoping. Reuses the
  // konsumen permission scope, same gate credit.routes.ts already uses.
  { label: "Piutang Anggota", href: "/piutang", icon: Receipt, module: "konsumen" as const, action: "read" as const }
];

const NAV_ITEMS_REPORTS = [
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
  // Consolidated-reporting-across-units — genuinely KSU-only, unlike Unit
  // Usaha below, so this is the one nav item that keeps a requiresMultiUnit
  // gate (CLAUDE.md rule 2b: KSU is `units.length > 1`, used sparingly and
  // only where the feature itself is about having multiple units).
  {
    label: "Laporan Konsolidasi",
    href: "/ksu/report",
    icon: PieChart,
    module: "reports" as const,
    action: "read" as const,
    requiresMultiUnit: true
  }
];

interface NavNode {
  label: string;
  href?: string;
  icon?: React.ElementType;
  children?: NavNode[];
}

function NavItemComponent({ item, onClose, level = 0 }: { item: NavNode; onClose?: () => void; level?: number }) {
  const [expanded, setExpanded] = useState(false);
  const isTop = level === 0;

  if (item.children && item.children.length > 0) {
    return (
      <div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className={cn(
            "flex w-full items-center rounded-md text-left font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white",
            isTop ? "gap-3 px-3 py-2.5 text-sm" : "gap-2 px-3 py-2 text-sm text-slate-400"
          )}
        >
          {item.icon && <item.icon className={cn("shrink-0", isTop ? "h-4 w-4" : "h-3.5 w-3.5")} />}
          <span className="flex-1 text-left">{item.label}</span>
          <svg
            className={cn("h-3 w-3 shrink-0 transition-transform", expanded && "rotate-90")}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {expanded && (
          <div className="ml-3 mt-1 space-y-1 border-l border-slate-700 pl-2">
            {item.children.map((child) => (
              <NavItemComponent key={child.href ?? child.label} item={child} onClose={onClose} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.href!}
      end
      onClick={onClose}
      className={({ isActive }) =>
        cn(
          "flex rounded-md transition-colors",
          // items-start (not items-center) below the top level: a long
          // label like "Anggota Menunggak" wraps at deep indentation, and a
          // vertically-centered icon next to two-line text reads as a big
          // empty gap. Single-line labels look identical either way.
          isTop ? "items-center gap-3 px-3 py-2.5 text-sm font-medium" : "items-start gap-2 px-3 py-2 text-sm",
          isActive
            ? "border-l-2 border-primary bg-slate-700 text-white"
            : isTop
              ? "text-slate-300 hover:bg-slate-700 hover:text-white"
              : "text-slate-400 hover:bg-slate-700 hover:text-white"
        )
      }
    >
      {item.icon && <item.icon className={cn("shrink-0", isTop ? "h-4 w-4" : "mt-0.5 h-3 w-3")} />}
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

  // Unit Usaha tree — KSP (Simpanan/Pinjaman) and Konsumen (Toko) as
  // sub-groups, each gated on its own module permission exactly like the old
  // top-level Simpanan/Pinjaman items were, NOT on isMultiUnit: most tenants
  // are single-unit (CLAUDE.md rule 2b), and gating this whole tree on
  // units.length > 1 would strand every single-unit tenant with no nav path
  // to their own Simpanan/Pinjaman/Toko. isMultiUnit stays reserved for
  // genuinely multi-unit features (Laporan Konsolidasi above).
  const kspChildren: NavNode[] = [];
  if (can("savings", "read")) {
    kspChildren.push({ label: "Simpanan", href: "/savings", icon: PiggyBank });
  }
  if (can("loans", "read")) {
    kspChildren.push({
      label: "Pinjaman",
      href: "/loans",
      icon: CreditCard,
      children: [
        { label: "Semua Pinjaman", href: "/loans" },
        { label: "Anggota Menunggak", href: "/loans/overdue", icon: AlertTriangle }
      ]
    });
  }

  const konsumenChildren: NavNode[] = [];
  if (can("konsumen", "read")) {
    konsumenChildren.push({ label: "Toko", href: "/ksu/toko" });
  }

  const unitUsahaChildren: NavNode[] = [];
  if (kspChildren.length > 0) unitUsahaChildren.push({ label: "KSP", icon: Landmark, children: kspChildren });
  if (konsumenChildren.length > 0) unitUsahaChildren.push({ label: "Konsumen", icon: Store, children: konsumenChildren });

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
            {NAV_ITEMS_TOP.map((item) => {
              if (!can(item.module, item.action)) return null;
              return <NavItemComponent key={item.href} item={item} onClose={onClose} />;
            })}
            {unitUsahaChildren.length > 0 && (
              <NavItemComponent
                item={{ label: "Unit Usaha", icon: Layers, children: unitUsahaChildren }}
                onClose={onClose}
              />
            )}
            {NAV_ITEMS_REPORTS.map((item) => {
              if (!can(item.module, item.action)) return null;
              if (item.requiresMultiUnit && !isMultiUnit) return null;
              return <NavItemComponent key={item.href} item={item} onClose={onClose} />;
            })}
            {(can("config", "read") || can("roles", "read") || can("accounting", "read")) && (
              <NavItemComponent
                item={{ label: "Konfigurasi", href: "/config", icon: Settings }}
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
