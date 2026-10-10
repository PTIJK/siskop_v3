import type { CompareMode } from "@siskop/types";

/**
 * The earlier period a statement is compared against. Everything here works on plain
 * YYYY-MM-DD strings (the Asia/Jakarta calendar days the reports already speak) with UTC
 * arithmetic, so the server's timezone can never shift a boundary by a day.
 */

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

const parse = (key: string): Ymd => {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return { y, m, d };
};
const pad = (n: number) => String(n).padStart(2, "0");
const format = ({ y, m, d }: Ymd) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isMonthEnd = ({ y, m, d }: Ymd) => d === daysInMonth(y, m);
const isMonthStart = ({ d }: Ymd) => d === 1;

/** Whole days between two dates, `b - a`. */
const dayNumber = ({ y, m, d }: Ymd) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
const fromDayNumber = (n: number): Ymd => {
  const dt = new Date(n * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};

/**
 * The same day `months` earlier. A day that does not exist there clamps to the month's last
 * day (31 March -> 28 February); a month end always stays a month end.
 */
function shiftMonths(date: Ymd, months: number): Ymd {
  const total = date.y * 12 + (date.m - 1) - months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const last = daysInMonth(y, m);
  return { y, m, d: isMonthEnd(date) ? last : Math.min(date.d, last) };
}

/** [from, to] one comparison step back: the same year a year ago, or the span immediately before. */
export function comparisonRange(compare: CompareMode, from: string, to: string): { from: string; to: string } {
  const start = parse(from);
  const end = parse(to);

  if (compare === "PREVIOUS_YEAR") {
    return { from: format(shiftMonths(start, 12)), to: format(shiftMonths(end, 12)) };
  }

  // A run of whole calendar months compares with the same number of months before it, so
  // October is set against September (30 days), not against the last 31 days.
  if (isMonthStart(start) && isMonthEnd(end)) {
    const months = (end.y * 12 + end.m) - (start.y * 12 + start.m) + 1;
    return { from: format(shiftMonths(start, months)), to: format(shiftMonths(end, months)) };
  }

  const length = dayNumber(end) - dayNumber(start) + 1;
  const prevEnd = dayNumber(start) - 1;
  return { from: format(fromDayNumber(prevEnd - length + 1)), to: format(fromDayNumber(prevEnd)) };
}

/** The as-of date a balance sheet is compared against: a month earlier, or a year earlier. */
export function comparisonAsOf(compare: CompareMode, asOf: string): string {
  return format(shiftMonths(parse(asOf), compare === "PREVIOUS_YEAR" ? 12 : 1));
}
