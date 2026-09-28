import { endOfMonth, startOfMonth } from "date-fns";
import { endOfBusinessDay, startOfBusinessDay } from "./operating-calendar.js";

/**
 * An explicit date-string query param used as an inclusive upper bound must be
 * widened to the end of that calendar day — `new Date('2026-07-26')` is UTC
 * midnight, so without this any row created later that same day is silently
 * excluded (see siskop-v3-date-range-endpoint-bug-class memory / BUG-3 in the
 * pre-rescaffold QA cycle). The lower bound needs the mirror-image treatment:
 * a row posted late in the UTC day can already be "today" in Jakarta, so a
 * raw `new Date(from)` (UTC midnight) lower bound for that same calendar day
 * would wrongly exclude it too.
 *
 * Uses `endOfBusinessDay`/`startOfBusinessDay` (Asia/Jakarta), not date-fns's
 * `endOfDay`/`startOfDay`: those compute "start/end of day" in the *server
 * process's* local timezone, which for a UTC-midnight date string is wrong
 * for roughly 7 hours a day even on a Jakarta box — see endOfBusinessDay's doc.
 *
 * Omitted bounds default to the current calendar month.
 */
export function resolvePeriod(from?: string, to?: string): { start: Date; end: Date } {
  return {
    start: from ? startOfBusinessDay(new Date(from)) : startOfMonth(new Date()),
    end: to ? endOfBusinessDay(new Date(to)) : endOfMonth(new Date())
  };
}
