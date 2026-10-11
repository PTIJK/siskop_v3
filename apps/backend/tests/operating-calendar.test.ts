import { describe, it, expect } from "vitest";
import {
  addOperatingDays,
  businessDate,
  dateKey,
  endOfBusinessDay,
  isOperatingDay,
  nextOperatingDay,
  parseDateKey,
  startOfBusinessDay,
  type OperatingCalendar
} from "../src/lib/operating-calendar.js";

// 2026-10-03 is a Saturday, 2026-10-04 a Sunday.
const cal: OperatingCalendar = {
  closedWeekdays: [0],
  holidays: new Set(["2026-10-05"]) // Monday holiday
};

describe("operating calendar", () => {
  it("round-trips a date key at UTC midnight", () => {
    const d = parseDateKey("2026-10-03");
    expect(d.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(dateKey(d)).toBe("2026-10-03");
  });

  it("treats Sundays and tenant holidays as closed", () => {
    expect(isOperatingDay(parseDateKey("2026-10-03"), cal)).toBe(true);
    expect(isOperatingDay(parseDateKey("2026-10-04"), cal)).toBe(false);
    expect(isOperatingDay(parseDateKey("2026-10-05"), cal)).toBe(false);
    expect(isOperatingDay(parseDateKey("2026-10-06"), cal)).toBe(true);
  });

  it("nextOperatingDay keeps an operating day and shifts a closed one forward", () => {
    expect(dateKey(nextOperatingDay(parseDateKey("2026-10-03"), cal))).toBe("2026-10-03");
    // Sunday → Monday is a holiday → Tuesday.
    expect(dateKey(nextOperatingDay(parseDateKey("2026-10-04"), cal))).toBe("2026-10-06");
  });

  it("addOperatingDays counts only operating days strictly after the start", () => {
    const sat = parseDateKey("2026-10-03");
    expect(dateKey(addOperatingDays(sat, 1, cal))).toBe("2026-10-06");
    expect(dateKey(addOperatingDays(sat, 2, cal))).toBe("2026-10-07");
    // Starting on a closed day works the same way.
    expect(dateKey(addOperatingDays(parseDateKey("2026-10-04"), 1, cal))).toBe("2026-10-06");
  });

  it("refuses a calendar with no operating day at all instead of looping forever", () => {
    const closed: OperatingCalendar = { closedWeekdays: [0, 1, 2, 3, 4, 5, 6], holidays: new Set() };
    expect(() => nextOperatingDay(parseDateKey("2026-10-03"), closed)).toThrow();
  });

  it("businessDate is the calendar date in Asia/Jakarta (UTC+7)", () => {
    // 18:30 UTC on Oct 3 is already 01:30 on Oct 4 in Jakarta.
    expect(dateKey(businessDate(new Date("2026-10-03T18:30:00Z")))).toBe("2026-10-04");
    expect(dateKey(businessDate(new Date("2026-10-03T16:59:59Z")))).toBe("2026-10-03");
  });

  describe("endOfBusinessDay", () => {
    it("is always at or after `now`, even for an instant late in the UTC day (Jakarta's next calendar day)", () => {
      // 23:33 UTC on Oct 3 is 06:33 on Oct 4 in Jakarta — a naive `new Date()`
      // cutoff (or date-fns `endOfDay` on a non-Jakarta server) would put the
      // boundary hours in the past relative to this instant.
      const now = new Date("2026-10-03T23:33:00Z");
      expect(endOfBusinessDay(now).getTime()).toBeGreaterThanOrEqual(now.getTime());
    });

    it("is exactly 16:59:59.999 UTC for the Jakarta calendar day matching a UTC-midnight date string", () => {
      // new Date("2026-10-03") from a "YYYY-MM-DD" query param — this is the
      // explicit-asOfDate path (reports/routes.ts, lib/period.ts).
      expect(endOfBusinessDay(new Date("2026-10-03")).toISOString()).toBe("2026-10-03T16:59:59.999Z");
    });

    it("includes an entry dated 'right now' when now is past midnight UTC but still today in Jakarta", () => {
      // The exact regression this fixes: a transaction entryDate of "now"
      // must never be excluded by the same instant's own end-of-day cutoff.
      const now = new Date("2026-10-03T23:33:00Z");
      expect(now.getTime()).toBeLessThanOrEqual(endOfBusinessDay(now).getTime());
    });
  });

  describe("startOfBusinessDay", () => {
    it("is exactly 17:00:00.000 UTC the day before, for the Jakarta calendar day matching a UTC-midnight date string", () => {
      // new Date("2026-10-03") from a "YYYY-MM-DD" query param — Jakarta's
      // Oct 3 begins at UTC+7 midnight, i.e. 17:00 UTC on Oct 2.
      expect(startOfBusinessDay(new Date("2026-10-03")).toISOString()).toBe("2026-10-02T17:00:00.000Z");
    });

    it("includes an entry posted late in the UTC day that is still today in Jakarta, as a lower bound", () => {
      // Same regression as endOfBusinessDay, but for the *lower* bound: an
      // entry timestamped 23:33 UTC on Oct 3 is already Oct 4 in Jakarta, so
      // a naive `new Date("2026-10-04")` (UTC midnight) lower bound would
      // wrongly exclude it.
      const entryDate = new Date("2026-10-03T23:33:00Z");
      expect(startOfBusinessDay(new Date("2026-10-04")).getTime()).toBeLessThanOrEqual(entryDate.getTime());
    });
  });
});
