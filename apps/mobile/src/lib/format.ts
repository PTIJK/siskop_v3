// Ported from apps/frontend/src/lib/format.ts. `formatRupiahSingkat` is the
// *default* for mobile cards/lists (not an afterthought like on desktop,
// where it's only used in chart axes) — docs/06-PRD-SISKOP-Mobile-Version.md
// §8.3: every desktop screen that showed the long form in a constrained
// width was a concrete overflow risk in the UI audit.
export function formatRupiah(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "Rp 0";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(num);
}

// Magnitude checks use the absolute value with the sign re-applied — the
// original (apps/frontend/src/lib/format.ts, ported verbatim at first) compared
// the signed number directly, so e.g. -3_483_202 failed every `>=` threshold
// and silently fell through to the long form. Only surfaced once a screen
// (Neraca — a negative cash balance is a real accounting case) actually
// rendered a negative amount through this function; found 2026-08-13.
export function formatRupiahSingkat(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "Rp 0";
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `${sign}Rp ${(abs / 1_000).toFixed(0)}rb`;
  return formatRupiah(num);
}

export function formatTanggalIndonesia(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function formatTanggalPendek(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}
