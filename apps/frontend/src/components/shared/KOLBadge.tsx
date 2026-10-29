import type { KOLCategory } from "@siskop/types";
import { cn } from "../../lib/utils";

type Tone = "ok" | "info" | "bad";
type Marker = "circle" | "square" | "triangle";

/** design.md §2.4. Five levels, always written "KOL n Nama"; colour only supports the marker shape and the words. */
const KOL_CONFIG: Record<KOLCategory, { level: number; label: string; tone: Tone; marker: Marker }> = {
  LANCAR: { level: 1, label: "Lancar", tone: "ok", marker: "circle" },
  DALAM_PERHATIAN: { level: 2, label: "Dalam perhatian", tone: "info", marker: "square" },
  KURANG_LANCAR: { level: 3, label: "Kurang lancar", tone: "bad", marker: "triangle" },
  DIRAGUKAN: { level: 4, label: "Diragukan", tone: "bad", marker: "triangle" },
  MACET: { level: 5, label: "Macet", tone: "bad", marker: "triangle" }
};

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-success/[0.13] text-success",
  info: "bg-info/[0.13] text-info",
  bad: "bg-destructive/[0.13] text-destructive"
};

const MARKER_CLASS: Record<Marker, string> = {
  circle: "h-[7px] w-[7px] rounded-full bg-current",
  square: "h-[7px] w-[7px] rounded-[1px] bg-current",
  triangle: "h-2 w-2 bg-current [clip-path:polygon(50%_0,100%_100%,0_100%)]"
};

export const KOL_ORDER: readonly KOLCategory[] = ["LANCAR", "DALAM_PERHATIAN", "KURANG_LANCAR", "DIRAGUKAN", "MACET"];

/** Level number and name for a category, for legends and charts that need the same wording. */
export function kolText(category: KOLCategory | string): string {
  const config = KOL_CONFIG[category as KOLCategory];
  return config ? `KOL ${config.level} ${config.label}` : String(category);
}

interface KOLBadgeProps {
  category: KOLCategory | string;
  className?: string;
}

export function KOLBadge({ category, className }: KOLBadgeProps) {
  const config = KOL_CONFIG[category as KOLCategory];
  if (!config) {
    return (
      <span className={cn("inline-flex h-6 items-center rounded-[7px] bg-muted px-2.5 text-xs font-bold text-muted-foreground", className)}>
        {String(category)}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-xs font-bold",
        TONE_CLASS[config.tone],
        className
      )}
    >
      <span aria-hidden="true" className={cn("inline-block shrink-0", MARKER_CLASS[config.marker])} />
      {`KOL ${config.level} ${config.label}`}
    </span>
  );
}
