import { describe, expect, it } from "vitest";
import { presetRange, todayLocal, validatePeriod } from "./period";

describe("todayLocal", () => {
  it("uses the local calendar date, not UTC", () => {
    // 2026-10-10 02:00 local time — UTC date would still be the 9th in UTC+7 zones' evening, so build from local parts.
    const d = new Date(2026, 9, 10, 2, 0, 0);
    expect(todayLocal(d)).toBe("2026-10-10");
  });
});

describe("presetRange", () => {
  const now = new Date(2026, 9, 10, 12, 0, 0); // 10 Oct 2026
  it("hari-ini", () => expect(presetRange("hari-ini", now)).toEqual({ from: "2026-10-10", to: "2026-10-10" }));
  it("bulan-ini", () => expect(presetRange("bulan-ini", now)).toEqual({ from: "2026-10-01", to: "2026-10-10" }));
  it("bulan-lalu", () => expect(presetRange("bulan-lalu", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" }));
  it("bulan-lalu across a year boundary", () =>
    expect(presetRange("bulan-lalu", new Date(2027, 0, 15))).toEqual({ from: "2026-12-01", to: "2026-12-31" }));
  it("tahun-ini", () => expect(presetRange("tahun-ini", now)).toEqual({ from: "2026-01-01", to: "2026-10-10" }));
});

describe("validatePeriod", () => {
  const today = "2026-10-10";
  it("accepts a valid range", () => expect(validatePeriod("2026-10-01", "2026-10-10", today)).toBeNull());
  it("requires both dates", () => {
    expect(validatePeriod("", "2026-10-10", today)).toMatch(/Tanggal Awal/);
    expect(validatePeriod("2026-10-01", "", today)).toMatch(/Tanggal Akhir/);
  });
  it("rejects end before start", () => expect(validatePeriod("2026-10-05", "2026-10-01", today)).toMatch(/sebelum/));
  it("rejects future dates", () => expect(validatePeriod("2026-10-01", "2026-10-11", today)).toMatch(/hari ini/));
});
