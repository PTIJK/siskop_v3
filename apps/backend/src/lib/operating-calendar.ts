import type { db, TxClient } from "./db.js";

/**
 * Which calendar days a koperasi collects on: every day except its closed
 * weekdays (Sunday by default) and its own holiday list. Dates are calendar
 * days represented as UTC-midnight `Date`s — the same shape Prisma returns for
 * a `@db.Date` column — so no server-timezone offset can shift a due date.
 */
export interface OperatingCalendar {
  /** 0 = Sunday … 6 = Saturday, as `Date#getUTCDay`. */
  closedWeekdays: readonly number[];
  /** `YYYY-MM-DD` keys. */
  holidays: ReadonlySet<string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Asia/Jakarta has no DST, so the business date is a fixed UTC+7 shift.
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
// A calendar that closes every weekday would otherwise loop forever.
const MAX_SEARCH_DAYS = 366;

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Today's (or `now`'s) calendar date in Asia/Jakarta, as UTC midnight. */
export function businessDate(now: Date = new Date()): Date {
  return parseDateKey(dateKey(new Date(now.getTime() + JAKARTA_OFFSET_MS)));
}

/**
 * End of `now`'s (or a caller-supplied instant's) calendar day in Asia/
 * Jakarta, as a real UTC instant — the upper bound a date-range query needs
 * so "today" is never excluded just because the server's raw `new Date()`
 * hasn't reached UTC midnight yet. `date-fns`'s `endOfDay` computes this in
 * the *server process's* local timezone instead, which silently breaks the
 * moment that differs from Jakarta (or even on a Jakarta box, produces the
 * wrong cutoff for roughly 7 hours a day — see the date-range bug class in
 * repository memory). Also correct for a caller-supplied `Date` that already
 * represents a calendar day (e.g. `new Date(asOfDate)` from a "YYYY-MM-DD"
 * query param): `businessDate()` re-derives the same calendar day either way.
 */
export function endOfBusinessDay(now: Date = new Date()): Date {
  const day = businessDate(now);
  return new Date(day.getTime() + DAY_MS - JAKARTA_OFFSET_MS - 1);
}

/**
 * Start of `now`'s (or a caller-supplied instant's) calendar day in Asia/
 * Jakarta, as a real UTC instant — the lower bound a date-range query needs
 * so a same-day entry posted late in the UTC day (already tomorrow in UTC,
 * still today in Jakarta) isn't excluded by a raw `new Date(dateString)`
 * (UTC midnight) lower bound. Mirrors `endOfBusinessDay`.
 */
export function startOfBusinessDay(now: Date = new Date()): Date {
  const day = businessDate(now);
  return new Date(day.getTime() - JAKARTA_OFFSET_MS);
}

export function isOperatingDay(d: Date, cal: OperatingCalendar): boolean {
  return !cal.closedWeekdays.includes(d.getUTCDay()) && !cal.holidays.has(dateKey(d));
}

/** `d` itself if it is an operating day, otherwise the first operating day after it. */
export function nextOperatingDay(d: Date, cal: OperatingCalendar): Date {
  let day = parseDateKey(dateKey(d));
  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    if (isOperatingDay(day, cal)) return day;
    day = new Date(day.getTime() + DAY_MS);
  }
  throw new Error("Operating calendar has no operating day within a year");
}

/** The `n`-th operating day strictly after `d` (n ≥ 1). */
export function addOperatingDays(d: Date, n: number, cal: OperatingCalendar): Date {
  let day = parseDateKey(dateKey(d));
  for (let i = 0; i < n; i++) {
    day = nextOperatingDay(new Date(day.getTime() + DAY_MS), cal);
  }
  return day;
}

export async function loadOperatingCalendar(
  client: typeof db | TxClient,
  tenantId: string
): Promise<OperatingCalendar> {
  const [tenant, holidays] = await Promise.all([
    client.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { closedWeekdays: true } }),
    client.tenantHoliday.findMany({ where: { tenantId }, select: { date: true } })
  ]);
  return {
    closedWeekdays: tenant.closedWeekdays,
    holidays: new Set(holidays.map((h) => dateKey(h.date)))
  };
}
