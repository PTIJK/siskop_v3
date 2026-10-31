import type { MigrationIssue } from "@siskop/types";

export function issueCounts(issues: readonly MigrationIssue[]) {
  return {
    errors: issues.filter((x) => x.severity === "error").length,
    warnings: issues.filter((x) => x.severity === "warning").length
  };
}

/** One group per sheet (sorted by name); inside, errors before warnings, then by row. */
export function groupIssues(issues: readonly MigrationIssue[]) {
  const map = new Map<string, MigrationIssue[]>();
  for (const x of issues) map.set(x.sheet, [...(map.get(x.sheet) ?? []), x]);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sheet, list]) => ({
      sheet,
      issues: [...list].sort((p, q) => (p.severity === q.severity ? (p.row ?? 0) - (q.row ?? 0) : p.severity === "error" ? -1 : 1))
    }));
}
