import { describe, expect, it } from "vitest";
import { formatDeltaPct, rowDelta } from "./compare";

describe("rowDelta", () => {
  it("is current minus previous, with the change as a share of the previous figure", () => {
    expect(rowDelta("1200", "1000")).toEqual({ amount: 200, pct: 20 });
    expect(rowDelta("800", "1000")).toEqual({ amount: -200, pct: -20 });
  });

  it("has no percentage when the earlier figure was zero or missing", () => {
    expect(rowDelta("500", "0")).toEqual({ amount: 500, pct: null });
    expect(rowDelta("500", undefined)).toEqual({ amount: 500, pct: null });
  });

  it("uses the size of a negative earlier figure so the sign still reads as better or worse", () => {
    expect(rowDelta("-50", "-100")).toEqual({ amount: 50, pct: 50 });
  });

  it("is zero when nothing changed", () => {
    expect(rowDelta("1000", "1000")).toEqual({ amount: 0, pct: 0 });
  });

  it("avoids float drift on sen amounts", () => {
    expect(rowDelta("0.30", "0.10").amount).toBe(0.2);
  });
});

describe("formatDeltaPct", () => {
  it("signs and rounds to one decimal in Indonesian format", () => {
    expect(formatDeltaPct(12.345)).toBe("+12,3%");
    expect(formatDeltaPct(-5)).toBe("-5%");
    expect(formatDeltaPct(0)).toBe("0%");
  });
  it("shows a dash when there is no base to compare against", () => {
    expect(formatDeltaPct(null)).toBe("-");
  });
});
