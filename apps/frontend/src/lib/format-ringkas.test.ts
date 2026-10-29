import { describe, expect, it } from "vitest";
import { formatRupiahRingkas } from "./format";

describe("formatRupiahRingkas", () => {
  it("writes millions with one decimal and a comma", () => {
    expect(formatRupiahRingkas(412_800_000)).toBe("Rp 412,8 jt");
  });

  it("writes billions with up to two decimals", () => {
    expect(formatRupiahRingkas(2_180_000_000)).toBe("Rp 2,18 M");
  });

  it("keeps small amounts exact", () => {
    expect(formatRupiahRingkas(950_000).normalize("NFKC")).toBe("Rp 950.000");
  });

  it("accepts Decimal strings and keeps the sign visible", () => {
    expect(formatRupiahRingkas("1250000000")).toBe("Rp 1,25 M");
    expect(formatRupiahRingkas(-3_400_000)).toBe("-Rp 3,4 jt");
  });

  it("falls back to zero for junk", () => {
    expect(formatRupiahRingkas("abc")).toBe("Rp 0");
  });
});

import { formatAngkaRingkas } from "./format";

describe("formatAngkaRingkas", () => {
  it("uses short units for chart axes", () => {
    expect(formatAngkaRingkas(2_000_000_000)).toBe("2,0 M");
    expect(formatAngkaRingkas(350_000_000)).toBe("350 jt");
    expect(formatAngkaRingkas(12_000)).toBe("12 rb");
    expect(formatAngkaRingkas(0)).toBe("0");
    expect(formatAngkaRingkas(-2_500_000_000)).toBe("-2,5 M");
  });
});

import { formatTanggalJamWib } from "./format";

describe("formatTanggalJamWib", () => {
  it("writes the Jakarta wall-clock time with WIB, regardless of the device zone", () => {
    // 14:35 UTC is 21:35 in Jakarta (UTC+7)
    expect(formatTanggalJamWib("2026-10-29T14:35:00.000Z")).toBe("29 Okt 2026, 21:35 WIB");
  });

  it("rolls the date over when UTC is still the previous day in Jakarta terms", () => {
    expect(formatTanggalJamWib("2026-10-29T18:05:00.000Z")).toBe("30 Okt 2026, 01:05 WIB");
  });

  it("shows a dash for an invalid date", () => {
    expect(formatTanggalJamWib("bukan tanggal")).toBe("-");
  });
});
