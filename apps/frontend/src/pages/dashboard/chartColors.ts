/**
 * Dashboard chart colors — the dataviz reference palette's first categorical
 * slots, in fixed order (validated light and dark: CVD ΔE 24.7, normal-vision
 * ΔE 33.6). Assign by entity, never by rank: disbursement is always slot 1.
 */
export const SERIES = {
  primary: "#2a78d6",
  secondary: "#eb6834"
} as const;

/** Status colors: reserved for good/warning/critical state, always shown with a label. */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b"
} as const;
