import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  isLoading?: boolean;
  alert?: boolean;
  onClick?: () => void;
}

// Mobile-specific — not a port of apps/frontend's StatCard, though it follows
// the same `min-w-0 flex-1` + `shrink-0` icon pattern that component already
// got right. The difference: this card is designed for a 2-up grid on a
// 375px screen from day one (desktop's StatCard only ever sits in a 1-up
// grid at that width), which is exactly the layout that broke on a real
// phone in a prior session (repository memory: "Study before UI build") —
// so `truncate` on the value is load-bearing here, not optional, and callers
// are expected to pass an already-short value (formatRupiahSingkat), not the
// long Rupiah form.
export function StatCard({ title, value, icon: Icon, isLoading, alert, onClick }: StatCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 text-left",
        onClick && "active:bg-accent",
        alert && "border-destructive ring-1 ring-destructive"
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-xs font-medium">{title}</span>
      </div>
      {isLoading ? (
        <div className="h-5 w-16 animate-pulse rounded bg-muted" />
      ) : (
        <span className={cn("truncate text-lg font-bold tracking-tight", alert && "text-destructive")}>{value}</span>
      )}
    </button>
  );
}
