export type ExportFormat = "csv" | "xlsx" | "pdf";

/** The CSV/XLSX download URL for a report: the same filters the report was run with, plus the format. */
export function exportPath(report: string, format: Exclude<ExportFormat, "pdf">, query: string): string {
  const filters = query.replace(/^&+/, "");
  return `/reports/export/${report}?format=${format}${filters ? `&${filters}` : ""}`;
}

export function exportFilename(stem: string, format: ExportFormat): string {
  return `${stem}.${format}`;
}
