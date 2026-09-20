import { endOfDay, endOfMonth, startOfMonth } from "date-fns";

/**
 * An explicit date-string query param used as an inclusive upper bound must be
 * widened to the end of that calendar day — `new Date('2026-07-26')` is UTC
 * midnight, so without this any row created later that same day is silently
 * excluded (see siskop-v3-date-range-endpoint-bug-class memory / BUG-3 in the
 * pre-rescaffold QA cycle). Lower bounds are fine as raw `new Date(...)`.
 *
 * Omitted bounds default to the current calendar month.
 */
export function resolvePeriod(from?: string, to?: string): { start: Date; end: Date } {
  return {
    start: from ? new Date(from) : startOfMonth(new Date()),
    end: to ? endOfDay(new Date(to)) : endOfMonth(new Date())
  };
}
