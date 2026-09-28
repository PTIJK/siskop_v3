/** RFC 4180 field quoting. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Defuses spreadsheet formula injection from a free-text field: a leading
 * =, +, -, @ gets a quote prefix so Excel/Sheets treat it as text. */
export function safeText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** Joins rows of already-stringified cells into an RFC 4180 CSV, CRLF-terminated. */
export function toCsv(rows: string[][]): string {
  return rows.map((cols) => cols.map(csvField).join(",")).join("\r\n") + "\r\n";
}
