// Ported from apps/frontend/src/pages/reports/regulatory/period.ts —
// default range for the regulatory reports that take a from/to period
// (Arus Kas, Laporan Hasil Usaha): month-to-date.
export function defaultPeriodFrom(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function defaultPeriodTo(): string {
  return new Date().toISOString().slice(0, 10);
}
