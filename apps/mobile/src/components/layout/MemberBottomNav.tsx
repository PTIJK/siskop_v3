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
