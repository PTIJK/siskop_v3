import { cn } from "@/lib/utils";

interface QuotaMeterProps {
  label: string;
  used: number;
  /** null = no limit on this package. */
  limit: number | null;
  className?: string;
}

/** Bar colour thresholds from design.md §8: normal, warning from 85%, destructive at 100%. */
function meterState(used: number, limit: number): { tone: "ok" | "warn" | "full"; text: string } {
  if (used > limit) return { tone: "full", text: "Melebihi batas" };
  if (used === limit) return { tone: "full", text: "Penuh" };
  if (limit > 0 && used / limit >= 0.85) return { tone: "warn", text: "Hampir penuh" };
  return { tone: "ok", text: "" };
}

const BAR_CLASS = { ok: "bg-success", warn: "bg-warning", full: "bg-destructive" } as const;
const TEXT_CLASS = { ok: "text-muted-foreground", warn: "text-warning", full: "text-destructive" } as const;

/** Label, "n/total", a 6px bar with role=meter. Always carries numbers and, near the cap, words: never colour alone. */
export function QuotaMeter({ label, used, limit, className }: QuotaMeterProps) {
  if (limit === null) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="font-bold">{label}</span>
          <span className="tabular-nums text-muted-foreground">{used} · tanpa batas</span>
        </div>
      </div>
    );
  }
  const state = meterState(used, limit);
  const percent = limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-bold">{label}</span>
        <span className={cn("tabular-nums", TEXT_CLASS[state.tone], state.tone !== "ok" && "font-bold")}>
          {used}/{limit}
          {state.text ? ` · ${state.text}` : ""}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} dari ${limit}${state.text ? `, ${state.text.toLowerCase()}` : ""}`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full", BAR_CLASS[state.tone])} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
