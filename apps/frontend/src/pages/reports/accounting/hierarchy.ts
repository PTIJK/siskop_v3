// Static class names (not built from the level) so Tailwind's scanner keeps them.
const INDENT = ["pl-0", "pl-3", "pl-6", "pl-9"] as const;

/** Name-cell classes for a chart-of-accounts row: indent by depth, group (header) rows bold. */
export function hierarchyClass(level: number, isHeader: boolean): string {
  const step = Math.min(Math.max(level, 1) - 1, INDENT.length - 1);
  return isHeader ? `${INDENT[step]} font-bold` : INDENT[step]!;
}
