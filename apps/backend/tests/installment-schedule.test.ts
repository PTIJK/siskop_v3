import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { buildSchedule } from "../src/lib/installment-schedule.js";
import { dateKey, parseDateKey, type OperatingCalendar } from "../src/lib/operating-calendar.js";

// 2026-10-03 is a Saturday, 2026-10-04 a Sunday, 2026-10-05 (Monday) a holiday —
// same fixture as tests/operating-calendar.test.ts.
const cal: OperatingCalendar = {
  closedWeekdays: [0],
  holidays: new Set(["2026-10-05"])
};

describe("buildSchedule", () => {
  it("DAILY: seq 1 lands on the first operating day after disbursement", () => {
    const schedule = buildSchedule({
      principal: "1000000",
      totalAmount: "1010000",
      frequency: "DAILY",
      count: 100,
      disbursedAt: parseDateKey("2026-10-03"),
      calendar: cal
    });
    // Sat 10/03 -> Sun 10/04 closed, Mon 10/05 holiday -> Tue 10/06.
    expect(dateKey(schedule[0].dueDate)).toBe("2026-10-06");
    expect(schedule).toHaveLength(100);
  });

  it("DAILY: no installment ever falls on a closed weekday or a holiday", () => {
    const schedule = buildSchedule({
      principal: "1000000",
      totalAmount: "1010000",
      frequency: "DAILY",
      count: 100,
      disbursedAt: parseDateKey("2026-10-03"),
      calendar: cal
    });
    for (const inst of schedule) {
      const day = inst.dueDate.getUTCDay();
      expect(day).not.toBe(0);
      expect(dateKey(inst.dueDate)).not.toBe("2026-10-05");
    }
  });

  it("DAILY: seq is strictly increasing by due date", () => {
    const schedule = buildSchedule({
      principal: "1000000",
      totalAmount: "1010000",
      frequency: "DAILY",
      count: 10,
      disbursedAt: parseDateKey("2026-10-03"),
      calendar: cal
    });
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].dueDate.getTime()).toBeGreaterThan(schedule[i - 1].dueDate.getTime());
      expect(schedule[i].seq).toBe(schedule[i - 1].seq + 1);
    }
  });

  it("WEEKLY: +7 calendar days, shifted to the next operating day when closed", () => {
    const schedule = buildSchedule({
      principal: "1000000",
      totalAmount: "1050000",
      frequency: "WEEKLY",
      count: 3,
      disbursedAt: parseDateKey("2026-09-28"), // Monday
      calendar: cal
    });
    // +7 -> 2026-10-05, a holiday -> next operating day 2026-10-06.
    expect(dateKey(schedule[0].dueDate)).toBe("2026-10-06");
    // +14 -> 2026-10-12 (Monday, operating).
    expect(dateKey(schedule[1].dueDate)).toBe("2026-10-12");
  });

  it("MONTHLY: +1 month, shifted to the next operating day when closed", () => {
    const schedule = buildSchedule({
      principal: "1000000",
      totalAmount: "1050000",
      frequency: "MONTHLY",
      count: 2,
      disbursedAt: parseDateKey("2026-09-05"),
      calendar: cal
    });
    // +1 month -> 2026-10-05, a holiday -> 2026-10-06.
    expect(dateKey(schedule[0].dueDate)).toBe("2026-10-06");
    // +2 months -> 2026-11-05 (Thursday, operating).
    expect(dateKey(schedule[1].dueDate)).toBe("2026-11-05");
  });

  it("sums of principalDue and interestDue equal principal and total interest exactly", () => {
    const schedule = buildSchedule({
      principal: "1000000",
      totalAmount: "1234567.89",
      frequency: "DAILY",
      count: 37,
      disbursedAt: parseDateKey("2026-10-03"),
      calendar: cal
    });
    const sumPrincipal = schedule.reduce((s, i) => s.plus(i.principalDue), new Prisma.Decimal(0));
    const sumInterest = schedule.reduce((s, i) => s.plus(i.interestDue), new Prisma.Decimal(0));
    expect(sumPrincipal.toString()).toBe("1000000");
    expect(sumInterest.toString()).toBe("234567.89");
  });

  it("rounds each installment up to the nearest Rp500, plugging the remainder into the last one", () => {
    const schedule = buildSchedule({
      principal: "1000000",
      totalAmount: "1100000",
      frequency: "MONTHLY",
      count: 30,
      disbursedAt: parseDateKey("2026-10-03"),
      calendar: cal
    });
    const amounts = schedule.map((i) => i.principalDue.plus(i.interestDue).toString());
    expect(amounts.slice(0, 29)).toEqual(Array(29).fill("37000"));
    expect(amounts[29]).toBe("27000");
  });
});
