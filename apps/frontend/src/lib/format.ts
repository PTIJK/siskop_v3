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

export function formatRupiahSingkat(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "Rp 0";
  if (num >= 1_000_000_000) return `Rp ${(num / 1_000_000_000).toFixed(1)}M`;
  if (num >= 1_000_000) return `Rp ${(num / 1_000_000).toFixed(1)}jt`;
  if (num >= 1_000) return `Rp ${(num / 1_000).toFixed(0)}rb`;
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

/** Like formatRupiah but keeps sen (up to 2 decimals) — for statements, where
 * rounding daily interest would make the running balance look wrong. */
export function formatRupiahRinci(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "Rp 0";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(num);
}

/** Report cells: zero, empty and unparseable amounts read as "-" so a column of
 * mostly-empty accounts stays scannable. Other screens keep using formatRupiah. */
export function formatRupiahOrDash(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "-";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num) || num === 0) return "-";
  return formatRupiah(num);
}

/** "1 Oktober 2026 – 10 Oktober 2026", or a single date when the range is one day.
 * Takes YYYY-MM-DD strings; parsed as local dates so the day never shifts with timezone. */
export function formatPeriode(from: string, to: string): string {
  const parse = (s: string) => {
    const [y = 0, m = 1, d = 1] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  return from === to
    ? formatTanggalIndonesia(parse(from))
    : `${formatTanggalIndonesia(parse(from))} – ${formatTanggalIndonesia(parse(to))}`;
}
