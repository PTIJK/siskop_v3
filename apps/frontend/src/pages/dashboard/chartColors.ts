/**
 * Dashboard chart colours, taken from the theme tokens so light and dark both
 * follow design.md §2 (chart-1 ink / chart-2 amber). Series are also told apart
 * by line style, never by colour alone (design.md §9.8).
 */
export const SERIES = {
  primary: "hsl(var(--chart-1))",
  secondary: "hsl(var(--chart-2))"
} as const;

/** Status colours: reserved for good/warning/critical state, always shown with a label. */
export const STATUS = {
  good: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  critical: "hsl(var(--destructive))"
} as const;

/** One colour per KOL level (design.md §2.4); the level number is also printed in each segment. */
export const KOL_COLORS = {
  LANCAR: "hsl(var(--success))",
  DALAM_PERHATIAN: "hsl(var(--info))",
  KURANG_LANCAR: "hsl(var(--warning))",
  DIRAGUKAN: "hsl(var(--destructive))",
  MACET: "hsl(var(--foreground))"
} as const;
