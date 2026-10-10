import { describe, expect, it } from "vitest";
import { formatPeriode, formatRupiahOrDash } from "./format";

describe("formatRupiahOrDash", () => {
  it("shows a dash for zero, empty and invalid values", () => {
    expect(formatRupiahOrDash(0)).toBe("-");
    expect(formatRupiahOrDash("0")).toBe("-");
    expect(formatRupiahOrDash("0.00")).toBe("-");
    expect(formatRupiahOrDash("")).toBe("-");
    expect(formatRupiahOrDash(null)).toBe("-");
    expect(formatRupiahOrDash(undefined)).toBe("-");
    expect(formatRupiahOrDash("abc")).toBe("-");
  });

  it("formats non-zero amounts like formatRupiah", () => {
    expect(formatRupiahOrDash(1500)).toMatch(/^Rp\s?1\.500$/);
    expect(formatRupiahOrDash("-2500")).toMatch(/^-Rp\s?2\.500$/);
  });
});

describe("formatPeriode", () => {
  it("renders both dates in Indonesian long form", () => {
    expect(formatPeriode("2026-10-01", "2026-10-10")).toBe("1 Oktober 2026 – 10 Oktober 2026");
  });

  it("collapses to a single date when from equals to", () => {
    expect(formatPeriode("2026-10-10", "2026-10-10")).toBe("10 Oktober 2026");
  });
});

describe("formatPercent", () => {
  it("shows a percentage string from the API in Indonesian format, up to two decimals", async () => {
    const { formatPercent } = await import("./format");
    expect(formatPercent("12.5")).toBe("12,5%");
    expect(formatPercent("0")).toBe("0%");
    expect(formatPercent("33.33")).toBe("33,33%");
    expect(formatPercent("100")).toBe("100%");
  });

  it("is a dash for no value", async () => {
    const { formatPercent } = await import("./format");
    expect(formatPercent(null)).toBe("-");
    expect(formatPercent(undefined)).toBe("-");
    expect(formatPercent("abc")).toBe("-");
  });
});
