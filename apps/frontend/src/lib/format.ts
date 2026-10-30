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

/** "12.5" -> "12,5%". Null/undefined/garbage -> "-" (a ratio that could not be computed, e.g. nothing fell due). */
export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "-";
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n)}%`;
}

/** NIK shown masked (design.md §9.7): first four and last four digits, e.g. 3174••••••0012. */
export function maskNik(nik: string): string {
  if (nik.length <= 8) return nik;
  return `${nik.slice(0, 4)}${"•".repeat(nik.length - 8)}${nik.slice(-4)}`;
}

/**
 * Compact rupiah for KPI tiles (design.md §9.7): "Rp 412,8 jt", "Rp 2,18 M".
 * Below one million the full amount is shown. The exact value belongs in a title/table next to it.
 */
export function formatRupiahRingkas(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "Rp 0";
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  const fmt = (n: number, digits: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }).format(n);
  if (abs >= 1_000_000_000) return `${sign}Rp ${fmt(abs / 1_000_000_000, 2)} M`;
  if (abs >= 1_000_000) return `${sign}Rp ${fmt(abs / 1_000_000, 1)} jt`;
  return formatRupiah(num);
}

/** Axis tick without the currency prefix: "2,0 M", "350 jt", "12 rb" (design.md §9.8). */
export function formatAngkaRingkas(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const one = (n: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  if (abs >= 1_000_000_000) return `${sign}${one(abs / 1_000_000_000)} M`;
  if (abs >= 1_000_000) return `${sign}${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(abs / 1_000_000)} jt`;
  if (abs >= 1_000) return `${sign}${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(abs / 1_000)} rb`;
  return `${sign}${abs}`;
}

const JAKARTA = "Asia/Jakarta";

/** "29 Okt 2026, 21:35 WIB": date and time in Asia/Jakarta, whatever the device's own zone (design.md §9.7). */
export function formatTanggalJamWib(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";
  const day = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: JAKARTA }).format(d);
  const parts = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: JAKARTA }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${day}, ${hh}:${mm} WIB`;
}
