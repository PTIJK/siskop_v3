/** Radix Select can't hold an empty value, so "no unit filter" is this sentinel. */
export const ALL_UNITS = "__all__";

/** The `&unitId=` fragment for a report URL — empty for the consolidated report. */
export function unitQueryParam(unitId: string): string {
  return unitId === ALL_UNITS ? "" : `&unitId=${encodeURIComponent(unitId)}`;
}
