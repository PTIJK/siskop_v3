import { describe, it, expect } from "vitest";
import {
  addOperatingDays,
  businessDate,
  dateKey,
  isOperatingDay,
  nextOperatingDay,
  parseDateKey,
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
});
