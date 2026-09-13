import { describe, it, expect } from "vitest";
import { calculateSavingInterest, calculateDailySavingInterest } from "../src/lib/saving-calc.js";

describe("calculateSavingInterest", () => {
  it("computes the yearly interest as the full annual rate", () => {
    expect(calculateSavingInterest(1_000_000, 9, "YEARLY")).toBeCloseTo(90_000, 2);
  });

  it("computes the monthly interest as the annual rate / 12", () => {
    expect(calculateSavingInterest(1_000_000, 9, "MONTHLY")).toBeCloseTo(7_500, 2);
  });

  it("computes the daily interest as the annual rate / 360 (matches the loan HARIAN day-count convention)", () => {
    expect(calculateSavingInterest(1_000_000, 9, "DAILY")).toBeCloseTo(250, 2);
  });

  it("returns 0 for a zero rate regardless of period", () => {
    expect(calculateSavingInterest(5_000_000, 0, "DAILY")).toBe(0);
  });
});

describe("calculateDailySavingInterest", () => {
  it("is a shorthand for calculateSavingInterest(..., 'DAILY') — lets a config's daily-equivalent be checked no matter which period it's set to", () => {
    expect(calculateDailySavingInterest(2_000_000, 9)).toBeCloseTo(500, 2);
  });
});
