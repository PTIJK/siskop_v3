import { NavLink } from "react-router-dom";
import { LayoutDashboard, PiggyBank, CreditCard, User } from "lucide-react";
import { cn } from "@/lib/utils";

// A member's own scope only — no Anggota (that's other members) and no
// Laporan (cooperative-wide regulatory reports), unlike BottomNav for staff.
const TABS = [
  { label: "Beranda", href: "/anggota/dashboard", icon: LayoutDashboard },
  { label: "Simpanan", href: "/anggota/simpanan", icon: PiggyBank },
  { label: "Pinjaman", href: "/anggota/pinjaman", icon: CreditCard },
  { label: "Profil", href: "/anggota/profil", icon: User }
];

export function MemberBottomNav() {
  return (
    <nav
      aria-label="Menu anggota"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t bg-card px-2 pt-1.5"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.href}
          to={tab.href}
          className={({ isActive }) =>
            cn(
              "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[12px] text-[11px] font-bold transition-colors",
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
