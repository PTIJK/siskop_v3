import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, PiggyBank, CreditCard, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

// 5 items — the Fase 1 read-only module scope (docs/06-PRD-SISKOP-Mobile-Version.md §6):
// Dashboard/Members/Savings/Loans/Reports. Config/Platform Admin/Users are
// out of scope, so unlike desktop's Sidebar there is no permission-gated nav
// item list yet — every logged-in mobile session sees the same 5 tabs. Revisit
// if a role that shouldn't see one of these ever needs to log into the mobile
// app (not expected for Fase 1's field-staff/management personas).
const TABS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Anggota", href: "/members", icon: Users },
  { label: "Simpanan", href: "/savings", icon: PiggyBank },
  { label: "Pinjaman", href: "/loans", icon: CreditCard },
  { label: "Laporan", href: "/reports", icon: FileText }
];

export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((tab) => (
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
