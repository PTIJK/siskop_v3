import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, PiggyBank, CreditCard, FileText, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";

// 5 items — the Fase 1 read-only module scope (docs/06-PRD-SISKOP-Mobile-Version.md §6):
// Dashboard/Members/Savings/Loans/Reports. Config/Platform Admin/Users are
// out of scope, so unlike desktop's Sidebar there is no permission-gated nav
// item list yet — every logged-in mobile session sees the same 5 tabs.
// The one exception: a 6th "Setoran" tab for the `collections` permission
// (koperasi pasar F6's Kolektor write exception, see
// docs/06-PRD-SISKOP-Mobile-Version.md and RequireCollectionsAccess.tsx) —
// the first role that needs a tab the rest of Fase 1 doesn't show.
const TABS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Anggota", href: "/members", icon: Users },
  { label: "Simpanan", href: "/savings", icon: PiggyBank },
  { label: "Pinjaman", href: "/loans", icon: CreditCard },
  { label: "Laporan", href: "/reports", icon: FileText }
];

export function BottomNav() {
  const canCollect = useAuth((s) => !!s.user?.permissions.collections?.read);
  const tabs = canCollect ? [...TABS, { label: "Setoran", href: "/kolektor", icon: Wallet }] : TABS;

  return (
    <nav
      aria-label="Menu utama"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t bg-card px-2 pt-1.5"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.href}
          to={tab.href}
          className={({ isActive }) =>
            cn(
              "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[12px] text-[11px] font-bold transition-colors",
              isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"
            )
          }
        >
          <tab.icon className="h-5 w-5" aria-hidden="true" />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
