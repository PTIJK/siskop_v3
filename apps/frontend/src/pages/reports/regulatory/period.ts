export type PeriodPreset = "hari-ini" | "bulan-ini" | "bulan-lalu" | "tahun-ini";

export const PERIOD_PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "hari-ini", label: "Hari ini" },
  { id: "bulan-ini", label: "Bulan ini" },
  { id: "bulan-lalu", label: "Bulan lalu" },
  { id: "tahun-ini", label: "Tahun ini" }
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local calendar date as YYYY-MM-DD. toISOString() is UTC and reads as yesterday before 07:00 WIB. */
export function todayLocal(now: Date = new Date()): string {
  return ymd(now);
}

export function defaultPeriodFrom(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
}

export function defaultPeriodTo(now: Date = new Date()): string {
  return todayLocal(now);
}

export function presetRange(preset: PeriodPreset, now: Date = new Date()): { from: string; to: string } {
  const today = todayLocal(now);
  switch (preset) {
    case "hari-ini":
      return { from: today, to: today };
    case "bulan-ini":
      return { from: defaultPeriodFrom(now), to: today };
    case "bulan-lalu": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: ymd(first), to: ymd(last) };
    }
    case "tahun-ini":
      return { from: `${now.getFullYear()}-01-01`, to: today };
  }
}

/** Returns a user-facing error, or null when the range is fine. YYYY-MM-DD strings compare lexically. */
export function validatePeriod(from: string, to: string, today: string = todayLocal()): string | null {
  if (!from) return "Masukkan Tanggal Awal terlebih dahulu";
  if (!to) return "Masukkan Tanggal Akhir terlebih dahulu";
  if (to < from) return "Tanggal Akhir tidak boleh sebelum Tanggal Awal";
  if (from > today || to > today) return "Tanggal tidak boleh melebihi hari ini";
  return null;
}
