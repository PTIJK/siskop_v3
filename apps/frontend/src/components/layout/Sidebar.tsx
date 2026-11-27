import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight, Lock, X } from "lucide-react";
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

function NavItem({ item, rail, onNavigate, setupLocked }: { item: ResolvedNavEntry; rail: boolean; onNavigate?: () => void; setupLocked?: boolean }) {
  const Icon = item.icon;
  const blockedBySetup = Boolean(setupLocked && item.href !== "/dashboard");
  const isLocked = item.locked || blockedBySetup;
  const lockTitle = blockedBySetup ? "Selesaikan pengaturan awal di Beranda terlebih dahulu" : "Belum termasuk paket Anda";

  if (blockedBySetup) {
    return (
      <span
        aria-disabled="true"
        title={rail ? `${item.label} (terkunci)` : lockTitle}
        className={cn(
          "relative flex min-h-[44px] cursor-not-allowed items-center gap-[11px] rounded-[10px] px-2.5 py-2 text-[15px] font-semibold text-muted-foreground/70",
          rail && "justify-center"
        )}
      >
        <Icon className="h-[18px] w-[18px] shrink-0 opacity-60" strokeWidth={1.75} aria-hidden="true" />
        {!rail && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        {!rail && <Lock className="h-[14px] w-[14px] shrink-0 opacity-60" aria-hidden="true" />}
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.href === "/dashboard" || item.href === "/loans" || item.href === "/reports" || item.href === "/savings" || item.href === "/members"}
      onClick={onNavigate}
      title={rail ? item.label : isLocked ? lockTitle : undefined}
      aria-label={rail ? (isLocked ? `${item.label} (terkunci)` : item.label) : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex min-h-[44px] items-center gap-[11px] rounded-[10px] px-2.5 py-2 text-[15px] font-semibold transition-colors duration-150 hover:bg-sidebar-active/70",
          rail && "justify-center",
          // An entry that is locked is never "the current page": it goes to Langganan instead.
          isActive && !isLocked && "bg-sidebar-active shadow-[inset_3px_0_0_hsl(var(--primary))]",
          isLocked && "text-muted-foreground"
        )
      }
      // NavLink sets aria-current="page" itself while active.
    >
      <Icon className="h-[18px] w-[18px] shrink-0 opacity-85" strokeWidth={1.75} aria-hidden="true" />
      {!rail && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {isLocked && !rail && (
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
    <div className="mt-auto rounded-[12px] border bg-card p-3 text-[13.5px]">
      <p className="truncate text-[14.5px] font-extrabold">Paket {data.packageName}</p>
      <p className="mb-2 text-muted-foreground">{data.status === "ACTIVE" ? "Langganan aktif" : "Perlu perhatian"}</p>
      <QuotaMeter label="Anggota aktif" used={data.usage.members} limit={data.limits.members} />
    </div>
  );
}

interface SidebarContentProps {
  rail: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
  setupLocked?: boolean;
}

function SidebarContent({ rail, onNavigate, onClose, setupLocked }: SidebarContentProps) {
  const sections = useNavSections();
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto border-r bg-sidebar px-3 py-4 text-sidebar-foreground">
      <div className={cn("flex items-center gap-2.5 px-2 pb-3.5 pt-1", rail && "justify-center px-0")}>
        <BrandMark alt={rail ? "NexCoop" : ""} />
        {!rail && <span className="flex-1 text-[17px] font-extrabold tracking-[-0.01em]">NexCoop</span>}
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
        {sections.map((section, index) => rail ? (
          <div key={section.group} role="group" aria-label={section.label} className="flex flex-col gap-0.5">
            {index > 0 && <div aria-hidden="true" className="mx-1.5 my-2.5 h-px bg-border" />}
            {section.items.map((item) => (
              <NavItem key={item.id} item={item} rail={rail} onNavigate={onNavigate} setupLocked={setupLocked} />
            ))}
          </div>
        ) : (
          <details key={section.group} className="group/section">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-[15px] font-bold hover:bg-sidebar-active/70 active:bg-sidebar-active focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">{section.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 group-open/section:rotate-90" aria-hidden="true" />
            </summary>
            <div className="flex flex-col gap-0.5 pl-2">
              {section.items.map((item) => (
                <NavItem key={item.id} item={item} rail={false} onNavigate={onNavigate} setupLocked={setupLocked} />
              ))}
            </div>
          </details>
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
  setupLocked?: boolean;
}

/**
 * Desktop: sticky 248px column (72px rail). At 900px and below it becomes a
 * drawer from the left with a scrim; Esc and the scrim close it.
 */
export function Sidebar({ rail, mobileOpen, onMobileOpenChange, setupLocked }: SidebarProps) {
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
        <SidebarContent setupLocked={setupLocked} rail={false} onNavigate={() => onMobileOpenChange(false)} onClose={() => onMobileOpenChange(false)} />
      </aside>

      <aside
        aria-label="Navigasi"
        className={cn("sticky top-0 z-sidebar hidden h-screen shrink-0 min-[901px]:block", rail ? "w-[72px]" : "w-[248px]")}
      >
        <SidebarContent rail={rail} setupLocked={setupLocked} />
      </aside>
    </>
  );
}
