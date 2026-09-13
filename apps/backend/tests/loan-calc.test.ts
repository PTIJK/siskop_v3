import { describe, it, expect } from "vitest";
import { calculateLoan } from "../src/lib/loan-calc.js";

describe("calculateLoan", () => {
  it("computes conventional (anuitas) monthly payment correctly", () => {
    const result = calculateLoan(3_000_000, 12, 12, "KONVENSIONAL", "BUNGA");

    expect(result.monthlyPayment).toBeCloseTo(266_546.37, 1);
    expect(result.totalAmount).toBeGreaterThan(3_000_000);
    expect(result.totalInterest).toBeCloseTo(result.totalAmount - 3_000_000, 2);
  });

  it("computes syariah (flat margin) total interest correctly", () => {
    const result = calculateLoan(3_000_000, 12, 12, "SYARIAH", "BAGI_HASIL");

    expect(result.totalInterest).toBeCloseTo(360_000, 2);
    expect(result.totalAmount).toBeCloseTo(3_360_000, 2);
    expect(result.monthlyPayment).toBeCloseTo(280_000, 2);
  });

  it("treats a MARGIN rate type as flat margin even for a KONVENSIONAL loan type", () => {
    const result = calculateLoan(1_000_000, 10, 10, "KONVENSIONAL", "MARGIN");
    expect(result.totalInterest).toBeCloseTo(1_000_000 * 0.1 * (10 / 12), 2);
  });

  it("divides principal evenly when the rate is zero", () => {
    const result = calculateLoan(1_200_000, 0, 12, "KONVENSIONAL", "BUNGA");
    expect(result.monthlyPayment).toBe(100_000);
    expect(result.totalInterest).toBe(0);
  });

  it("computes bunga harian (flat, /360 day-count) using the actual term days", () => {
    const result = calculateLoan(3_000_000, 12, 12, "KONVENSIONAL", "HARIAN", { termDays: 365 });

    // dailyRate = 12/360/100; totalInterest = 3_000_000 * dailyRate * 365
    expect(result.totalInterest).toBeCloseTo(365_000, 2);
    expect(result.totalAmount).toBeCloseTo(3_365_000, 2);
    expect(result.monthlyPayment).toBeCloseTo(3_365_000 / 12, 2);
  });

  it("falls back to a 30-day month when termDays is not supplied", () => {
    const result = calculateLoan(1_000_000, 10, 10, "KONVENSIONAL", "HARIAN");

    // 10 months * 30 days = 300 days, matching the flat-margin annual formula exactly.
    expect(result.totalInterest).toBeCloseTo(1_000_000 * 0.1 * (10 / 12), 2);
  });

  it("treats a zero rate as zero interest for HARIAN too", () => {
    const result = calculateLoan(1_200_000, 0, 12, "KONVENSIONAL", "HARIAN", { termDays: 365 });
    expect(result.totalInterest).toBe(0);
    expect(result.monthlyPayment).toBe(100_000);
  });
});
