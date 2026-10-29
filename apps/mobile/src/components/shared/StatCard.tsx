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

// Mobile-specific — designed for a 2-up grid on a 375px screen from day one,
// so `truncate` on the value is load-bearing, not optional, and callers are
// expected to pass an already-short value (formatRupiahSingkat), not the long
// Rupiah form. Visual language follows design.md §8: 1px line, no shadow.
export function StatCard({ title, value, icon: Icon, isLoading, alert, onClick }: StatCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex min-h-[88px] min-w-0 flex-col justify-between gap-2 rounded-[16px] border bg-card p-3.5 text-left transition-colors",
        onClick && "active:bg-muted",
        alert && "border-destructive"
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-accent text-accent-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="truncate text-xs font-semibold">{title}</span>
      </div>
      {isLoading ? (
        <div className="h-6 w-20 animate-pulse rounded bg-muted" />
      ) : (
        <span className={cn("money truncate text-xl font-extrabold tracking-tight", alert && "text-destructive")}>
          {value}
        </span>
      )}
    </button>
  );
}
