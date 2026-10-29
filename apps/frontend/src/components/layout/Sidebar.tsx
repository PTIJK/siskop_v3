import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Lock, X } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useIsMultiUnit } from "@/hooks/useIsMultiUnit";
import { useEntitlements, useSubscription } from "@/hooks/useEntitlements";
import { useAuth } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { QuotaMeter } from "@/components/shared/QuotaMeter";
import { buildNav, type NavSection, type ResolvedNavEntry } from "./nav";
import { BrandMark } from "./BrandMark";

/** Menu for the current user: role permissions hide entries, package features lock them. */
export function useNavSections(): NavSection[] {
  const { can } = usePermissions();
  const { isLocked } = useEntitlements();
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  // Fails closed while /config/units is pending, so multi-unit entries never flash in early.
  const isMultiUnit = useIsMultiUnit().data ?? false;
  return buildNav({ can, isLocked, isPlatformAdmin, isMultiUnit });
}

function NavItem({ item, rail, onNavigate }: { item: ResolvedNavEntry; rail: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.href === "/dashboard" || item.href === "/loans" || item.href === "/reports" || item.href === "/savings" || item.href === "/members"}
      onClick={onNavigate}
      title={rail ? item.label : item.locked ? "Belum termasuk paket Anda" : undefined}
      aria-label={rail ? (item.locked ? `${item.label} (terkunci)` : item.label) : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex min-h-[40px] items-center gap-[11px] rounded-[10px] px-2.5 py-2 text-[13.5px] font-semibold transition-colors duration-150 hover:bg-sidebar-active/70 max-[900px]:min-h-[44px]",
          rail && "justify-center",
          // An entry that is locked is never "the current page": it goes to Langganan instead.
          isActive && !item.locked && "bg-sidebar-active shadow-[inset_3px_0_0_hsl(var(--primary))]",
          item.locked && "text-muted-foreground"
        )
      }
      // NavLink sets aria-current="page" itself while active.
    >
      <Icon className="h-[18px] w-[18px] shrink-0 opacity-85" strokeWidth={1.75} aria-hidden="true" />
      {!rail && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {item.locked && !rail && (
        <>
          <Lock className="h-[14px] w-[14px] shrink-0 opacity-65" aria-hidden="true" />
          <span className="sr-only">(terkunci, belum termasuk paket Anda)</span>
        </>
      )}
    </NavLink>
  );
}

function TenantCard() {
  const { data } = useSubscription();
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  if (!data || isPlatformAdmin) return null;
  return (
    <div className="mt-auto rounded-[12px] border bg-card p-3 text-[12.5px]">
      <p className="truncate text-[13.5px] font-extrabold">Paket {data.packageName}</p>
      <p className="mb-2 text-muted-foreground">{data.status === "ACTIVE" ? "Langganan aktif" : "Perlu perhatian"}</p>
      <QuotaMeter label="Anggota aktif" used={data.usage.members} limit={data.limits.members} />
    </div>
  );
}

interface SidebarContentProps {
  rail: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
}

function SidebarContent({ rail, onNavigate, onClose }: SidebarContentProps) {
  const sections = useNavSections();
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto border-r bg-sidebar px-3 py-4 text-sidebar-foreground">
      <div className={cn("flex items-center gap-2.5 px-2 pb-3.5 pt-1", rail && "justify-center px-0")}>
        <BrandMark />
        {!rail && <span className="flex-1 text-[17px] font-extrabold tracking-[-0.01em]">SISKOP</span>}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup menu"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label="Menu utama" className="flex flex-col gap-1">
        {sections.map((section, index) => (
          <div key={section.group} role="group" aria-label={section.label} className="flex flex-col gap-0.5">
            {rail ? (
              index > 0 && <div aria-hidden="true" className="mx-1.5 my-2.5 h-px bg-border" />
            ) : (
              <p className={cn("px-2.5 pb-1 text-xs font-bold text-muted-foreground", index > 0 ? "mt-3" : "mt-1")}>{section.label}</p>
            )}
            {section.items.map((item) => (
              <NavItem key={item.id} item={item} rail={rail} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>

      {!rail && <TenantCard />}
    </div>
  );
}

interface SidebarProps {
  rail: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

/**
 * Desktop: sticky 248px column (72px rail). At 900px and below it becomes a
 * drawer from the left with a scrim; Esc and the scrim close it.
 */
export function Sidebar({ rail, mobileOpen, onMobileOpenChange }: SidebarProps) {
  const { pathname } = useLocation();

  useEffect(() => {
    onMobileOpenChange(false);
  }, [pathname, onMobileOpenChange]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, onMobileOpenChange]);

  return (
    <>
      {mobileOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-scrim bg-foreground/50 min-[901px]:hidden"
          onClick={() => onMobileOpenChange(false)}
        />
      )}

      <aside
        id="sidebar-mobile"
        aria-label="Navigasi"
        className={cn(
          "fixed inset-y-0 left-0 z-drawer w-[272px] max-w-[85vw] transition-transform duration-200 min-[901px]:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        // A closed drawer must not be tabbable or read by assistive tech.
        {...(mobileOpen ? { role: "dialog", "aria-modal": true } : { inert: "" as unknown as undefined, "aria-hidden": true })}
      >
        <SidebarContent rail={false} onNavigate={() => onMobileOpenChange(false)} onClose={() => onMobileOpenChange(false)} />
      </aside>

      <aside
        aria-label="Navigasi"
        className={cn("sticky top-0 z-sidebar hidden h-screen shrink-0 min-[901px]:block", rail ? "w-[72px]" : "w-[248px]")}
      >
        <SidebarContent rail={rail} />
      </aside>
    </>
  );
}
