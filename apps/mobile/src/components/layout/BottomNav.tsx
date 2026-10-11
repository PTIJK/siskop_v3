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
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.href}
          to={tab.href}
          className={({ isActive }) =>
            cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
              isActive ? "text-primary" : "text-muted-foreground"
            )
          }
        >
          <tab.icon className="h-5 w-5" />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
